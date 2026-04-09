// GROOVE GUI v2 — Entry Point
// FSL-1.1-Apache-2.0 — see LICENSE

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app';
import './app.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
