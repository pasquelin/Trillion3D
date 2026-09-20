import { Alert, Card } from '../components/UI.jsx';
import { CodeBlock } from '../components/CodeBlock.jsx';
import { planCode } from './roadmapPlan.js';
import { relatedReadyLesson } from './roadmapRelated.js';

const local = (value, locale) => value[locale === 'fr' ? 'fr' : 'en'];
export function PlannedCard({ entry, locale, expanded, onOpen }) {
  const french = locale === 'fr';
  const related = relatedReadyLesson(entry);
  return (
    <Card className="h-full shadow-sm overflow-hidden">
      <button
        type="button"
        className="grid gap-4 text-left rounded-box focus-visible:outline-2 focus-visible:outline-primary"
        aria-expanded={expanded}
        onClick={() => onOpen(entry.id)}
      >
        <div className="gallery-preview rounded-box bg-base-300 grid place-items-center p-6">
          <div className="text-center">
            <span className="text-4xl" aria-hidden="true">
              ◇
            </span>
            <p className="text-xs uppercase tracking-widest mt-3">
              {local(entry.categoryLabel, locale)}
            </p>
          </div>
        </div>
        <span className="badge badge-soft badge-warning">
          {french ? 'En cours de création' : 'In development'}
        </span>
        <h2 className="card-title text-lg">{local(entry.title, locale)}</h2>
        <p className="text-sm opacity-75 grow">{local(entry.concept, locale)}</p>
      </button>
      {expanded && (
        <>
          <Alert tone="warning">
            <span>
              <strong>{french ? 'Pourquoi :' : 'Why:'}</strong> {local(entry.reason, locale)}
            </span>
          </Alert>
          <CodeBlock
            locale={locale}
            label={french ? 'Plan non exécutable' : 'Non-runnable plan'}
            code={planCode(entry)}
          />
          {related && (
            <a className="link link-primary text-sm" href={`#/${locale}/playground/${related}`}>
              {french ? 'Voir une leçon prête associée' : 'See a related ready lesson'}
            </a>
          )}
        </>
      )}
    </Card>
  );
}
