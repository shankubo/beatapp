import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// L'i18n s'initialise avant le premier rendu: sans cela, la premiere frame
// afficherait des cles brutes.
import './i18n';
import './index.css';
import { App } from './App';

const container = document.getElementById('root');
if (!container) throw new Error('Element racine #root introuvable');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
