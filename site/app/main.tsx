import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { currentRoute } from './hooks/useRoute.ts';
import { loadLanguage } from './i18n.ts';

const root = document.getElementById('portal');
if (root) {
  // The first page renders in its language: its dictionary is read first.
  await loadLanguage(currentRoute().locale);
  createRoot(root).render(<App />);
}
