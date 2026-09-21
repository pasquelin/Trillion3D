import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';

const root = document.getElementById('portal');
if (root) {
  createRoot(root).render(<App />);
}
