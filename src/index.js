import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// This connects the JavaScript logic to the <div id="root"> in your HTML file
const root = ReactDOM.createRoot(document.getElementById('root'));

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);