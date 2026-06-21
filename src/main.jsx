import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

if (!window.storage) {
  window.storage = {
    async set(key, value) {
      localStorage.setItem(key, value);
    },
    async get(key) {
      const value = localStorage.getItem(key);
      return value === null ? null : { value };
    },
    async remove(key) {
      localStorage.removeItem(key);
    },
    async list(prefix) {
      const keys = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key && key.startsWith(prefix)) {
          keys.push(key);
        }
      }
      return { keys };
    },
  };
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
