import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, doc, updateDoc, setDoc, deleteDoc, query, where, serverTimestamp } from 'firebase/firestore';
import { Speaker, Pizza, Clock, Truck, Loader, MessageSquare, Mic } from 'lucide-react';

// --- Variáveis Globais (Fornecidas pelo Ambiente Canvas) ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof _firebase_config !== 'undefined' ? JSON.parse(_firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// --- Funções de Áudio (Web Audio API) ---
let audioContext = null;

const getAudioContext = () => {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioContext;
};

// Função para tocar um tom simples
const playTone = (frequency, duration, type, volume = 0.5) => {
  try {
    const context = getAudioContext();
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();

    oscillator.type = type; // 'sine', 'square', 'sawtooth', 'triangle'
    oscillator.frequency.setValueAtTime(frequency, context.currentTime);

    gainNode.gain.setValueAtTime(volume, context.currentTime);
    // Adiciona um pequeno fade out para evitar "clicks"
    gainNode.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration); 

    oscillator.connect(gainNode);
    gainNode.connect(context.destination);

    oscillator.start();
    oscillator.stop(context.currentTime + duration);
  } catch (e) {
    console.warn("Audio playback failed (Context not initialized or other error):", e);
  }
};

// Som de Sucesso (Pedido Cadastrado ou Status Atualizado - exceto PRONTA)
const playSuccessTone = () => {
  playTone(880, 0.1, 'sine', 0.8); // Tom A5
};

// Som de Erro (Comando Inválido ou Pedido Não Encontrado)
const playErrorTone = () => {
  playTone(150, 0.3, 'square', 0.6); // Tom grave e quadrado
};

// Som de Alerta para Pedido Pronto (Double-Beep para urgência)
const playReadyAlertTone = () => {
  try {
    const context = getAudioContext();
    const now = context.currentTime;
    
    // High beep 1
    const oscillator1 = context.createOscillator();
    const gainNode1 = context.createGain();
    oscillator1.connect(gainNode1);
    gainNode1.connect(context.destination);
    oscillator1.type = 'square';
    oscillator1.frequency.setValueAtTime(1000, now);
    gainNode1.gain.setValueAtTime(0.7, now);
    gainNode1.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    oscillator1.start(now);
    oscillator1.stop(now + 0.1);
    
    // High beep 2, delayed
    const oscillator2 = context.createOscillator();
    const gainNode2 = context.createGain();
    oscillator2.connect(gainNode2);
    gainNode2.connect(context.destination);
    oscillator2.type = 'square';
    oscillator2.frequency.setValueAtTime(1200, now + 0.15);
    gainNode2.gain.setValueAtTime(0.7, now + 0.15);
    gainNode2.gain.exponentialRampToValueAtTime(0.001, now + 0.23);
    oscillator2.start(now + 0.15);
    oscillator2.stop(now + 0.25);
  } catch (e) {
    console.warn("Audio playback failed (Context not initialized or other error):", e);
  }
};

// --- Funções TTS para Alerta de Duplicação ---

// Função para converter Base64 string para ArrayBuffer
const base64ToArrayBuffer = (base64) => {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
};

// Função para converter dados de áudio PCM para Blob WAV
const pcmToWav = (pcm16, sampleRate) => {
    const numChannels = 1;
    const bytesPerSample = 2; // 16-bit PCM
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = pcm16.length * bytesPerSample;

    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    
    // RIFF identifier 'RIFF'
    view.setUint32(0, 0x52494646, false);
    // file size (dataSize + 36)
    view.setUint32(4, dataSize + 36, true);
    // 'WAVE'
    view.setUint32(8, 0x57415645, false);
    // fmt sub-chunk 'fmt '
    view.setUint32(12, 0x666d7420, false);
    // sub-chunk size 16 (for PCM)
    view.setUint32(16, 16, true);
    // audio format 1 (PCM)
    view.setUint16(20, 1, true);
    // number of channels
    view.setUint16(22, numChannels, true);
    // sample rate
    view.setUint32(24, sampleRate, true);
    // byte rate (sampleRate * numChannels * bytesPerSample)
    view.setUint32(28, byteRate, true);
    // block align (numChannels * bytesPerSample)
    view.setUint16(32, blockAlign, true);
    // bits per sample
    view.setUint16(34, 16, true);
    // data sub-chunk 'data'
    view.setUint32(36, 0x64617461, false);
    // data size
    view.setUint32(40, dataSize, true);

    // Write PCM data
    for (let i = 0; i < pcm16.length; i++) {
        view.setInt16(44 + i * 2, pcm16[i], true);
    }

    return new Blob([view], { type: 'audio/wav' });
};

// Função para Alerta de Voz (Text-to-Speech)
const playTtsAlert = async (text) => {
    try {
        const apiKey = ""; 
        const apiUrl = https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey};

        const payload = {
            contents: [{
                parts: [{ text: text }]
            }],
            generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                    voiceConfig: {
                        // Usando Kore (Voz firme) para alerta sério
                        prebuiltVoiceConfig: { voiceName: "Kore" } 
                    }
                }
            },
            model: "gemini-2.5-flash-preview-tts"
        };
        
        // Tentativa única e imediata para minimizar a latência (removido backoff)
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) throw new Error("TTS API call failed with status: " + response.status);

        const result = await response.json();
        const part = result?.candidates?.[0]?.content?.parts?.[0];
        const audioData = part?.inlineData?.data;
        const mimeType = part?.inlineData?.mimeType;

        if (audioData && mimeType && mimeType.startsWith("audio/L16")) {
            const rateMatch = mimeType.match(/rate=(\d+)/);
            const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
            
            const pcmData = base64ToArrayBuffer(audioData);
            const pcm16 = new Int16Array(pcmData);
            const wavBlob = pcmToWav(pcm16, sampleRate);
            const audioUrl = URL.createObjectURL(wavBlob);
            
            const audio = new Audio(audioUrl);
            audio.play().catch(e => console.error("Error playing TTS audio:", e));
        } else {
            console.error("TTS response missing audio data or invalid mime type.");
            // Fallback para tom de erro rápido se a resposta do TTS for inválida
            playErrorTone(); 
        }

    } catch (e) {
        console.error("TTS generation error (Failing fast):", e);
        // Fallback para tom de erro rápido se a chamada falhar
        playErrorTone(); 
    }
};

// --- FIM Funções de Áudio e TTS ---


// Funções Auxiliares
const statusMap = {
  // O status 'Pendente' existe no modelo, mas não é exibido no KDS, pois a entrada é 'No Forno'
  'Pendente': { color: 'bg-red-500', icon: 'Clock', order: 1, title: 'Pendentes' },
  'No Forno': { color: 'bg-yellow-500', icon: 'Loader', order: 2, title: 'Em Preparo' },
  'Pronta': { color: 'bg-green-500', icon: 'Pizza', order: 3, title: 'Prontas' },
  'Despachada': { color: 'bg-blue-500', icon: 'Truck', order: 4, title: 'Despachadas' },
};

// Funções de Componentes (Ícones)
const Icon = ({ name, className }) => {
  const IconComponent = { Clock, Loader, Pizza, Truck, MessageSquare, Mic }[name] || MessageSquare;
  return <IconComponent className={className} />;
};


// Componente: Gerencia e exibe o tempo desde que o pedido ficou PRONTO
const ReadyTimeDisplay = ({ timestamp_pronta }) => {
  const [timeMetric, setTimeMetric] = useState('');

  useEffect(() => {
    const updateTime = () => {
      // Verifica se o timestamp de pronta existe e pode ser convertido para Data
      if (timestamp_pronta?.toDate) {
        const readyTime = timestamp_pronta.toDate();
        // Usamos a diferença em milissegundos
        const diffInMilliseconds = new Date().getTime() - readyTime.getTime();
        
        let displayTime;
        
        if (diffInMilliseconds < 60000) { // Menos de 60 segundos
          // Alterado para '0 min' conforme a solicitação para evitar o '< 1 min'
          displayTime = 'Pronta há 0 min'; 
        } else {
          // Para 1 minuto ou mais, usamos Math.floor para garantir que só conte o minuto completo
          const diffInMinutes = Math.floor(diffInMilliseconds / 60000);
          displayTime = Pronta há ${diffInMinutes} min;
        }
        
        setTimeMetric(displayTime);
      } else {
        setTimeMetric('');
      }
    };

    updateTime(); // Execução inicial

    // Atualiza a cada 1 minuto (60000 ms)
    const interval = setInterval(updateTime, 60000);
    return () => clearInterval(interval);
  }, [timestamp_pronta]); // Dependência no timestamp_pronta para reiniciar a contagem

  if (!timeMetric) return null;

  return (
    <p className="text-lg font-extrabold text-white bg-black/30 p-1 rounded-md">{timeMetric}</p>
  );
};


// Componente do Cartão de Pedido (Usado para 'No Forno' e 'Pronta')
const OrderCard = ({ pedido, handleUpdate, isDuplicate }) => {
  const statusInfo = statusMap[pedido.status_atual] || statusMap['Pendente'];

  // OBS: A lógica estática de timeMetric foi removida, pois agora é tratada pelo ReadyTimeDisplay.
  // Apenas mantemos as referências de tempo se necessário, mas não são usadas aqui.

  return (
    <div className={p-4 rounded-lg shadow-xl mb-4 transition-all duration-300 transform hover:scale-[1.01] ${statusInfo.color} bg-opacity-90 relative}>
      {/* Alerta Visual para ID Duplicado/Repetido */}
      {isDuplicate && (
        <div className="absolute top-0 right-0 bg-black text-white text-xs font-bold px-2 py-1 rounded-tr-lg rounded-bl-lg animate-pulse shadow-xl">
          ⚠️ ID REPETIDO NO FLUXO
        </div>
      )}
      
      <div className="flex items-center justify-between text-white border-b border-white/50 pb-2 mb-2">
        <h3 className="text-lg font-bold">#{pedido.id_pedido} - {pedido.canal_venda}</h3>
        <Icon name={statusInfo.icon} className="w-6 h-6" />
      </div>
      <p className="text-white font-semibold text-sm">{pedido.nome_cliente}</p>
      <p className="text-white text-xs opacity-80 mb-2">{pedido.detalhes_pizza}</p>

      <div className="mt-2 text-center">
        {/* Renderiza o componente de tempo apenas se o pedido estiver PRONTO */}
        {pedido.status_atual === 'Pronta' && (
          <ReadyTimeDisplay timestamp_pronta={pedido.timestamp_pronta} />
        )}
      </div>

      {/* Botão de Despacho (Só aparece se estiver Pronta) */}
      {pedido.status_atual === 'Pronta' && (
        <button
          onClick={() => handleUpdate(pedido.id)} // Não precisa de status, a função já define 'Despachada'
          className="mt-3 w-full bg-indigo-700 hover:bg-indigo-800 text-white font-bold py-2 px-4 rounded-lg transition duration-200 shadow-md shadow-indigo-900/50"
        >
          Despachar Pedido
        </button>
      )}
    </div>
  );
};

// Componente para o item da lista de pedidos Despachados
const DispatchedItem = ({ pedido }) => {
  const [timeAgo, setTimeAgo] = useState('');

  useEffect(() => {
    const updateTime = () => {
      if (pedido.timestamp_despachada?.toDate) {
        const dispatchTime = pedido.timestamp_despachada.toDate();
        // Diferença em minutos (Math.round() é aceitável aqui para "tempo atrás" em itens finalizados)
        const diffInMinutes = Math.round((new Date().getTime() - dispatchTime.getTime()) / 60000); 
        
        let displayTime = '';
        if (diffInMinutes < 1) {
          displayTime = 'Agora';
        } else if (diffInMinutes < 60) {
          displayTime = Há ${diffInMinutes} min;
        } else {
          const hours = Math.floor(diffInMinutes / 60);
          const minutes = diffInMinutes % 60;
          displayTime = Há ${hours}h ${minutes}m;
        }
        
        setTimeAgo(displayTime);
      } else {
        setTimeAgo('Tempo não registrado');
      }
    };

    updateTime(); // Execução inicial

    // Atualiza a cada 1 minuto (60000 ms)
    const interval = setInterval(updateTime, 60000);
    return () => clearInterval(interval);
  }, [pedido.timestamp_despachada]);

  return (
    <div className="flex justify-between items-center p-2 bg-blue-100 rounded-lg text-sm font-medium shadow-inner">
      <span className="font-bold text-blue-800 uppercase">{pedido.canal_venda} {pedido.id_pedido}</span>
      <span className="text-blue-600 text-xs">{timeAgo}</span>
    </div>
  );
};


// Componente Principal
const App = () => {
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [pedidos, setPedidos] = useState([]);
  const [voiceCommand, setVoiceCommand] = useState('');
  const [feedback, setFeedback] = useState({ message: 'Aguardando comandos...', type: 'info' });
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isListening, setIsListening] = useState(false); // Novo estado para ouvir o microfone
  const recognitionRef = React.useRef(null); // Referência para a instância do SpeechRecognition

  const KDS_COLLECTION_PATH = artifacts/${appId}/public/data/pedidos_kds;

  // 1. Inicialização do Firebase e Autenticação
  useEffect(() => {
    try {
      if (Object.keys(firebaseConfig).length === 0) {
        throw new Error("Firebase config not available.");
      }

      const app = initializeApp(firebaseConfig);
      const firestore = getFirestore(app);
      const authInstance = getAuth(app);
      
      setDb(firestore);
      setAuth(authInstance);

      const authenticate = async () => {
        if (initialAuthToken) {
          await signInWithCustomToken(authInstance, initialAuthToken);
        } else {
          await signInAnonymously(authInstance);
        }
        setUserId(authInstance.currentUser?.uid || 'Anon');
        setIsAuthReady(true);
      };
      authenticate();
    } catch (error) {
      console.error("Erro ao inicializar Firebase:", error);
      setFeedback({ message: Erro de Inicialização: ${error.message}, type: 'error' });
    }
  }, []);

  // 2. Listener do Firestore (Tempo Real)
  useEffect(() => {
    if (!db || !isAuthReady) return;

    const pedidosCollectionRef = collection(db, KDS_COLLECTION_PATH);
    const q = query(pedidosCollectionRef);

    // Monitora a coleção em tempo real
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedPedidos = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Verifica se houve mudança para 'Pronta' e dispara o alerta
      // NOTA: 'pedidos' aqui se refere ao valor do estado no momento da execução deste efeito
      const currentPedidos = JSON.parse(JSON.stringify(pedidos)); 
      
      fetchedPedidos.forEach(newP => {
        const oldP = currentPedidos.find(op => op.id === newP.id);
        if (newP.status_atual === 'Pronta' && oldP?.status_atual !== 'Pronta') {
          playSoundAlert(newP.canal_venda, newP.id_pedido, newP.nome_cliente);
        }
      });
      
      setPedidos(fetchedPedidos);

    }, (error) => {
      console.error("Erro ao ouvir Firestore:", error);
      setFeedback({ message: Erro no DB: Não foi possível carregar pedidos., type: 'error' });
    });

    return () => unsubscribe();
  }, [db, isAuthReady, pedidos.length]);

  // Função de Alerta Sonoro (Atualizada: Remove TTS, usa novo tom de alerta)
  const playSoundAlert = (canal, id, nome) => {
    const message = ATENÇÃO! Pedido ${canal} ${id}, do cliente ${nome}, pronto para embalar!;
    setFeedback({ message: message, type: 'success' });
    playReadyAlertTone(); // Toca o som de alerta para PRONTA
  };

  
  // Função para Iniciar a Captura de Voz (Web Speech API)
  const startVoiceInput = () => {
    // Garante que o AudioContext é iniciado por uma interação do usuário
    getAudioContext(); 
    
    if (!('webkitSpeechRecognition' in window)) {
      setFeedback({ message: 'Seu navegador não suporta a Web Speech API para microfone.', type: 'error' });
      return;
    }
    
    // Se já estiver ouvindo, pare para reiniciar
    if (isListening) {
      recognitionRef.current.stop();
      return;
    }

    const recognition = new window.webkitSpeechRecognition();
    recognition.lang = 'pt-BR';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      setIsListening(true);
      setFeedback({ message: 'Microfone Ativo. Diga o comando: [canal] [ID] [ação]', type: 'info' });
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setVoiceCommand(transcript);
      // Processa o comando imediatamente após a transcrição
      processVoiceCommand(transcript);
    };

    recognition.onerror = (event) => {
      setIsListening(false);
      console.error('Speech recognition error:', event);
      
      let errorMessage = 'Um erro desconhecido ocorreu. Tente novamente.';
      if (event.error) {
        switch (event.error) {
          case 'not-allowed':
            errorMessage = 'Permissão do microfone negada. Verifique as configurações do seu navegador.';
            break;
          case 'no-speech':
            errorMessage = 'Nenhuma fala detectada ou o tempo limite expirou. Fale mais alto e claramente.';
            break;
          case 'aborted':
            errorMessage = 'Reconhecimento de fala interrompido inesperadamente.';
            break;
          default:
            errorMessage = Erro de voz: ${event.error}. Tente novamente.;
        }
      }

      setFeedback({ message: errorMessage, type: 'error' });
      playErrorTone(); // Toca som de erro na falha de reconhecimento
    };

    recognition.onend = () => {
      setIsListening(false);
      if (!voiceCommand) {
        setFeedback({ message: 'Microfone desligado. Nenhuma fala detectada ou o comando falhou.', type: 'info' });
      }
    };

    recognition.start();
  };


  // 4. Módulo de Comando de Voz (Processamento Centralizado)
  const processVoiceCommand = async (commandText = voiceCommand) => {
    if (!db || !commandText) return;
    setFeedback({ message: 'Processando comando...', type: 'info' });

    // ASR + NLP (Análise Simplificada da String)
    const normalizedCommand = commandText.trim().toLowerCase();
    const parts = normalizedCommand.split(/\s+/);

    if (parts.length < 3) {
      setFeedback({ message: 'Comando inválido. Formato: [Canal] [ID] [Ação]. Ex: "ifood a123 pronta"', type: 'error' });
      playErrorTone(); // Som de Erro
      return;
    }

    // Extração das entidades: o primeiro é o canal, o segundo é o ID, o último é a ação.
    const canal = parts[0];
    const id = parts[1];
    const acao = parts[parts.length - 1];
    
    // Converte a primeira letra do canal para maiúscula para salvar
    const formattedCanal = canal.charAt(0).toUpperCase() + canal.slice(1);
    const formattedId = id.toUpperCase();
    
    // Log para fins de depuração:
    console.log([Comando Parsed] Canal: ${formattedCanal}, ID: ${formattedId}, Ação: ${acao});


    // Procura o pedido no array local
    const targetPedido = pedidos.find(p => p.id_pedido.toLowerCase() === formattedId.toLowerCase());
    
    // Log para fins de depuração:
    if (!targetPedido) {
        console.log([Busca DB] Pedido não encontrado no array local.);
    }

    // --- Lógica de Exclusão de Pedido ---
    if (acao === 'excluir' || acao === 'deletar') {
        if (!targetPedido) {
            setFeedback({ message: Pedido ${formattedCanal} ${formattedId} não encontrado. Nenhuma ação de exclusão realizada., type: 'error' });
            playErrorTone(); // Som de Erro
            return;
        }

        try {
            // Usa o id_pedido como ID do documento Firestore
            const pedidoRef = doc(db, KDS_COLLECTION_PATH, targetPedido.id_pedido); 
            await deleteDoc(pedidoRef);
            setVoiceCommand(''); // Limpa o comando
            setFeedback({ message: Pedido #${targetPedido.id_pedido} DELETADO com sucesso., type: 'success' });
            playSuccessTone(); // Som de Sucesso na exclusão
            return;
        } catch (e) {
            console.error("Erro ao deletar pedido:", e);
            setFeedback({ message: Erro ao deletar pedido., type: 'error' });
            playErrorTone(); // Som de Erro
            return;
        }
    }


    // --- Lógica de Criação de Pedido (Entrada no Fluxo) ---
    // Adicionado verificação para impedir que um ID existente seja recriado (previne sobrescrita de Despachados).
    if (targetPedido) {
        // Se a ação for para criar ('no forno') mas o ID já existe, é uma tentativa de duplicação.
        if (acao === 'forno' || acao === 'no' || acao === 'preparo') {
             setFeedback({ 
                message: O Pedido ${formattedCanal} ${formattedId} JÁ EXISTE (Status: ${targetPedido.status_atual}). Use um ID diferente para um novo pedido., 
                type: 'error' 
            });
            // ALERTA DE VOZ CONCISO E IMEDIATO (TTS)
            playTtsAlert(Pedido ${formattedCanal} ${formattedId} já cadastrado!);
            return;
        }
        // Se a ação não for 'no forno' (e.g., 'pronta'), continua para a lógica de atualização abaixo.
    }

    // Se o pedido não existir E a ação for para iniciar o preparo ('no forno'), CRIE o pedido.
    if (!targetPedido && (acao === 'forno' || acao === 'no' || acao === 'preparo')) {
        const newOrder = {
            id_pedido: formattedId,
            canal_venda: formattedCanal,
            nome_cliente: Cliente ${formattedId}, // Usando ID como placeholder de nome
            detalhes_pizza: 'Detalhes a serem consultados no sistema principal',
            status_atual: 'No Forno',
            timestamp_recebido: serverTimestamp(),
            timestamp_pronta: null,
            timestamp_despachada: null, // Adicionado campo de timestamp para despacho
            userId,
        };
        
        try {
            // Cria o documento, usando o id_pedido como ID do documento
            await setDoc(doc(db, KDS_COLLECTION_PATH, newOrder.id_pedido), newOrder);
            setVoiceCommand('');
            setFeedback({ message: Pedido #${newOrder.id_pedido} (Novo) criado com status 'No Forno'., type: 'success' });
            playSuccessTone(); // Som de Sucesso
            return; // Sai após a criação.
        } catch (e) {
            console.error("Erro ao criar pedido via voz:", e);
            setFeedback({ message: Erro ao criar pedido. Verifique o ID e canal., type: 'error' });
            playErrorTone(); // Som de Erro
            return;
        }
    } else if (!targetPedido) {
        // Se o pedido não existe e a ação NÃO é 'no forno' ou 'excluir/deletar', é um erro.
        setFeedback({ message: Pedido ${formattedCanal} ${formattedId} não encontrado. Use 'no forno' para criar ou 'excluir' para deletar., type: 'error' });
        playErrorTone(); // Som de Erro
        return;
    }
    
    // --- Lógica de Atualização de Status (Pedido Existente) ---
    
    // Usa o ID do documento Firestore (que é igual ao id_pedido)
    const docIdToUpdate = targetPedido.id_pedido;
    
    let newStatus = targetPedido.status_atual;
    let timestampUpdate = {};
    let statusFound = true;

    if (acao === 'forno' || acao === 'no' || acao === 'preparo') {
      newStatus = 'No Forno';
      timestampUpdate = { timestamp_pronta: null, timestamp_despachada: null }; // Reseta tempos se voltar ao preparo
    // Reconhece 'pronta' ou 'pronto'
    } else if (acao === 'pronta' || acao === 'pronto') {
      newStatus = 'Pronta';
      // Garante que o status só mude para Pronta se não estiver já despachado
      if (targetPedido.status_atual !== 'Despachada') {
        timestampUpdate = { timestamp_pronta: serverTimestamp(), timestamp_despachada: null }; // Registro de Timestamp
      }
    } else if (acao === 'saiu' || acao === 'despachada') {
      newStatus = 'Despachada';
      // Adicionado registro do tempo de despacho
      timestampUpdate = { timestamp_despachada: serverTimestamp() };
    } else {
      // Mensagem de erro atualizada para refletir o comando 'excluir'
      setFeedback({ message: Ação '${acao}' desconhecida. Use 'forno', 'pronta/pronto', 'saiu/despachada' ou 'excluir/deletar'., type: 'error' });
      playErrorTone(); // Som de Erro
      statusFound = false;
    }
    
    if (!statusFound) return;

    // 3. Atualização no Banco de Dados
    try {
      const pedidoRef = doc(db, KDS_COLLECTION_PATH, docIdToUpdate);
      await updateDoc(pedidoRef, { status_atual: newStatus, ...timestampUpdate });
      setVoiceCommand(''); // Limpa o comando
      setFeedback({ message: Status de #${docIdToUpdate} atualizado para '${newStatus}'., type: 'success' });
      
      // Usa o tom de sucesso geral para atualizações de status que NÃO são o alerta de 'Pronta' (que é tratado no onSnapshot)
      playSuccessTone(); 
    } catch (e) {
      console.error("Erro ao atualizar status:", e);
      setFeedback({ message: Erro ao atualizar status do pedido., type: 'error' });
      playErrorTone(); // Som de Erro
    }
  };

  // 5. Função para Despachar (Usado pelo Botão KDS)
  const handleDespachar = async (docId) => {
    if (!db) return;
    try {
      const pedidoRef = doc(db, KDS_COLLECTION_PATH, docId);
      // Incluído registro do tempo de despacho
      await updateDoc(pedidoRef, { 
        status_atual: 'Despachada', 
        timestamp_despachada: serverTimestamp() 
      });
      setFeedback({ message: Pedido despachado e removido do fluxo., type: 'success' });
      playSuccessTone(); // Som de Sucesso no despacho
    } catch (e) {
      console.error("Erro ao despachar:", e);
      setFeedback({ message: Erro ao despachar pedido., type: 'error' });
      playErrorTone(); // Som de Erro
    }
  };
  
  // NOVO: Calcula a frequência de IDs de pedidos para detectar duplicatas ativas
  const idFrequencies = useMemo(() => {
    return pedidos.reduce((acc, pedido) => {
        const id = pedido.id_pedido.toUpperCase();
        acc[id] = (acc[id] || 0) + 1;
        return acc;
    }, {});
  }, [pedidos]);

  // Agrupamento de pedidos por status para o KDS
  const groupedPedidos = useMemo(() => {
    return pedidos.reduce((acc, pedido) => {
      const status = pedido.status_atual;
      if (!acc[status]) {
        acc[status] = [];
      }
      // Filtra para exibir apenas 'No Forno', 'Pronta' e 'Despachada'
      if (status === 'No Forno' || status === 'Pronta' || status === 'Despachada') {
         acc[status].push(pedido);
      }
      return acc;
    }, {});
  }, [pedidos]);

  // Colunas a serem exibidas no KDS: Incluindo Despachadas
  const columns = useMemo(() => {
    return Object.keys(statusMap)
      .filter(key => key === 'No Forno' || key === 'Pronta' || key === 'Despachada')
      .sort((a, b) => statusMap[a].order - statusMap[b].order);
  }, []);
  
  const feedbackColor = feedback.type === 'error' ? 'bg-red-600' : feedback.type === 'success' ? 'bg-green-600' : 'bg-gray-600';

  return (
    <div className="min-h-screen bg-gray-100 p-4 font-inter">
      <header className="bg-white shadow-lg rounded-xl p-4 mb-6 sticky top-0 z-10">
        <h1 className="text-3xl font-extrabold text-gray-900 flex items-center">
          <Pizza className="w-8 h-8 mr-3 text-red-600" />
          SGV - KDS (Sistema de Gerenciamento por Voz)
        </h1>
        <div className="flex justify-between items-center mt-1">
            <p className="text-sm text-gray-500">
                Painel em Tempo Real para Produção e Despacho
            </p>
            {/* NOVO: Total de Pedidos */}
            <p className="text-lg font-bold text-gray-700 bg-gray-100 px-3 py-1 rounded-full border border-gray-300">
                Total de Pedidos: {pedidos.length}
            </p>
        </div>
        <div className="text-xs text-right text-gray-400 mt-2">
            Usuário: <span className="font-mono text-gray-600">{userId || 'Aguardando autenticação...'}</span>
        </div>
      </header>
      
      {/* Área de Feedback/Alerta */}
      <div className={p-3 rounded-lg text-white font-semibold flex items-center mb-6 transition-colors duration-300 ${feedbackColor}}>
        <Speaker className="w-5 h-5 mr-3" />
        {feedback.message}
      </div>

      {/* 4. Módulo de Comando de Voz (Forneiro) */}
      <section className="bg-white p-6 rounded-xl shadow-lg mb-6 border-l-4 border-yellow-500">
        <h2 className="text-xl font-bold text-gray-700 mb-4">Módulo de Comando de Voz (Forneiro)</h2>
        <p className="text-sm text-gray-500 mb-3">
          *Entrada de Comando:* Use o *microfone* ou digite o comando no formato *[canal] [ID] [ação]*.
          <br/>
          Obrigatório: Use [canal] [ID] no forno para *criar um novo pedido*.
          <br/>
          Novo: Use [canal] [ID] excluir (ou deletar) para *excluir o pedido*.
          <br/>
          Exemplo: balcão B12 pronta ou ifood A456 excluir
        </p>
        <div className="flex space-x-3 items-center">
          <button
            onClick={startVoiceInput}
            disabled={!isAuthReady}
            className={px-4 py-3 text-white font-bold rounded-lg transition duration-300 shadow-md flex items-center justify-center w-1/4 min-w-[120px] ${isListening ? 'bg-red-500 hover:bg-red-600 animate-pulse' : 'bg-green-600 hover:bg-green-700 disabled:bg-green-400'}}
          >
            <Mic className="w-5 h-5 mr-2" />
            {isListening ? 'Ouvindo...' : 'Falar Comando'}
          </button>
          
          <input
            type="text"
            className="flex-grow p-3 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
            placeholder="Ou digite manualmente aqui..."
            value={voiceCommand}
            onChange={(e) => setVoiceCommand(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') processVoiceCommand(); }}
            disabled={!isAuthReady || isListening}
          />
          <button
            onClick={() => processVoiceCommand()}
            disabled={!isAuthReady || voiceCommand.trim() === '' || isListening}
            className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg transition duration-200 shadow-md disabled:bg-red-400 min-w-[120px]"
          >
            Processar
          </button>
        </div>
      </section>

      {/* 1. Painel de Status (KDS) - Inclui Despachadas */}
      <main className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-6">
        {columns.map(status => (
          <div key={status} className="bg-white p-4 rounded-xl shadow-2xl border-t-8 border-gray-300">
            <h2 className="text-2xl font-extrabold mb-4 text-center p-2 rounded-lg text-gray-800">
              <Icon name={statusMap[status].icon} className="w-6 h-6 inline-block mr-2" />
              {statusMap[status].title} ({groupedPedidos[status]?.length || 0})
            </h2>
            <div className="space-y-4 min-h-[200px]">
              {groupedPedidos[status] && groupedPedidos[status].length > 0 ? (
                // Condicional para renderizar o cartão completo ou apenas o item despachado
                status === 'Despachada' ? (
                  // Custom rendering for Despachada (limitado aos 10 mais recentes)
                  groupedPedidos[status]
                    // Ordena do mais recente para o mais antigo pelo timestamp de despacho
                    .sort((a, b) => (b.timestamp_despachada?.toDate()?.getTime() || 0) - (a.timestamp_despachada?.toDate()?.getTime() || 0)) 
                    .slice(0, 10) 
                    .map(pedido => (
                      <DispatchedItem key={pedido.id} pedido={pedido} />
                    ))
                ) : (
                  // Standard rendering for No Forno and Pronta
                  groupedPedidos[status]
                    // Ordena do mais antigo para o mais novo pelo timestamp de recebimento
                    .sort((a, b) => a.timestamp_recebido?.toDate() - b.timestamp_recebido?.toDate())
                    .map(pedido => {
                        // Passa a flag de duplicação
                        const isDuplicate = idFrequencies[pedido.id_pedido.toUpperCase()] > 1;
                        return <OrderCard key={pedido.id} pedido={pedido} handleUpdate={handleDespachar} isDuplicate={isDuplicate} />;
                    })
                )
              ) : (
                // Mensagem de vazio
                <p className="text-center text-gray-400 italic p-6 border-2 border-dashed border-gray-300 rounded-lg mt-8">
                  Nenhum pedido neste status.
                </p>
              )}
            </div>
          </div>
        ))}
      </main>
    </div>
  );
};

export default App;