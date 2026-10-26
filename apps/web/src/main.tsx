import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// Self-hosted and bundled rather than fetched from Google: the font is on the critical path for
// first paint, so it should not cost two cross-origin connections before any text renders. The
// variable builds carry the full 100-900 range, which the 900-weight headings actually need.
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles/index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
