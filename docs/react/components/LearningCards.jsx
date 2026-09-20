import { Alert } from './UI.jsx';
export function LearningCards({ input, output, attempt, changes, locale = 'en' }) {
  const titles =
    locale === 'fr'
      ? ['Entrée', 'Sortie moteur', 'À essayer', 'Ce qui change']
      : ['Input', 'Engine output', 'What to try', 'What changes'];
  return (
    <div className="playground-cards grid gap-3 sm:grid-cols-2">
      {[input, output, attempt, changes].map((content, index) => (
        <Alert key={titles[index]}>
          <div className="min-w-0 break-words">
            <div className="text-xs font-bold uppercase opacity-60">{titles[index]}</div>
            <div className="text-sm tabular-nums">{content}</div>
          </div>
        </Alert>
      ))}
    </div>
  );
}
