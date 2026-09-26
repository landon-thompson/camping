import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ensureSeeds } from './db/records';
import './index.css';

// Starting data is created on the phone itself, so the app works on first
// launch even with no signal.
void ensureSeeds();

// Ask the browser not to evict offline data (granted automatically for
// installed Home Screen apps on iOS).
void navigator.storage?.persist?.();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
