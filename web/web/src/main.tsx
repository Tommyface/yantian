import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/design.css';
import './styles/app.css';
import { App } from './App';
import { DataProvider } from './data';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DataProvider>
      <App />
    </DataProvider>
  </React.StrictMode>
);
