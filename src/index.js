import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App'; // Importa o seu componente principal
import './index.css'; // Vamos criar este arquivo depois

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);