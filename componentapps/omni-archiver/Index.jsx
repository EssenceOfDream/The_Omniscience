import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

document.documentElement.style.margin = '0';
document.body.style.margin = '0';
document.body.style.overflow = 'auto';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>
);