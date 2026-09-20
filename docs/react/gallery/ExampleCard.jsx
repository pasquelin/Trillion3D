import { Alert, Card } from '../components/UI.jsx';
import { CodeBlock } from '../components/CodeBlock.jsx';
import { routeHref } from '../../js/portal/routes.js';
import { GeometryPreview } from './WebGPUCanvas.jsx';
import { planCode } from './roadmapPlan.js';
import { relatedReadyLesson } from './roadmapRelated.js';

const categories = {
  transforms: { en: 'Transforms', fr: 'Transformations' },
  camera: { en: 'Camera', fr: 'Caméra' },
  vectors: { en: 'Vectors', fr: 'Vecteurs' },
  bounds: { en: 'Bounds', fr: 'Volumes' },
  scene: { en: 'Scene', fr: 'Scène' },
  color: { en: 'Color', fr: 'Couleur' },
  streaming: { en: 'Streaming', fr: 'Streaming' },
};
const local = (value, locale) => value[locale === 'fr' ? 'fr' : 'en'];

export const engineExample = {
  id: 'engine-scene',
  category: 'streaming',
  engine: true,
  functions: ['WebGPU', 'LOD', 'streaming'],
  title: { en: 'Live streamed geometry', fr: 'Géométrie streamée en direct' },
  description: {
    en: 'Actual streaming and LOD pipeline.',
    fr: 'Pipeline réel de streaming et LOD.',
  },
};

function Preview({ example, locale, title }) {
  if (example.status === 'planned')
    return (
      <div className="h-full grid place-items-center p-6">
        <span className="text-4xl" aria-hidden="true">
          ◇
        </span>
      </div>
    );
  if (example.engine)
    return (
      <img
        className="h-full w-full object-cover"
        src="./assets/kinetic-garden/preview.png"
        alt={
          locale === 'fr'
            ? 'Jardin géométrique rendu par WebGPU'
            : 'Geometry garden rendered by WebGPU'
        }
      />
    );
  return (
    <GeometryPreview id={example.id} locale={locale} interactive={false} label={`${title} — 3D`} />
  );
}

function CardSummary({ example, locale, title, description, arrow = false }) {
  const french = locale === 'fr',
    planned = example.status === 'planned';
  return (
    <>
      <div className="gallery-preview rounded-box overflow-hidden bg-base-300">
        <Preview example={example} locale={locale} title={title} />
      </div>
      <span className={`badge badge-soft ${planned ? 'badge-warning' : 'badge-primary'}`}>
        {planned
          ? french
            ? 'En cours de création'
            : 'In development'
          : example.engine
            ? french
              ? 'Scène moteur'
              : 'Engine scene'
            : local(categories[example.category], locale)}
      </span>
      <h2 className="card-title text-lg">{title}</h2>
      <p className="text-sm opacity-75 grow">{description}</p>
      {arrow && (
        <span className="self-end text-primary text-xl" aria-hidden="true">
          →
        </span>
      )}
    </>
  );
}

function PlannedDetails({ example, locale }) {
  const french = locale === 'fr',
    related = relatedReadyLesson(example);
  return (
    <>
      <Alert tone="warning">
        <span>
          <strong>{french ? 'Pourquoi :' : 'Why:'}</strong> {local(example.reason, locale)}
        </span>
      </Alert>
      <CodeBlock
        locale={locale}
        label={french ? 'Plan non exécutable' : 'Non-runnable plan'}
        code={planCode(example)}
      />
      {related && (
        <a className="link link-primary text-sm" href={`#/${locale}/playground/${related}`}>
          {french ? 'Voir une leçon prête associée' : 'See a related ready lesson'}
        </a>
      )}
    </>
  );
}

export function ExampleCard({ example, locale = 'en', expanded = false, onOpen }) {
  const title = local(example.title, locale),
    description = local(example.description ?? example.concept, locale);
  if (example.status === 'planned')
    return (
      <Card className="h-full shadow-sm overflow-hidden">
        <button
          type="button"
          className="grid gap-4 text-left rounded-box focus-visible:outline-2 focus-visible:outline-primary"
          aria-expanded={expanded}
          onClick={() => onOpen(example.id)}
        >
          <CardSummary example={example} locale={locale} title={title} description={description} />
        </button>
        {expanded && <PlannedDetails example={example} locale={locale} />}
      </Card>
    );
  const href = routeHref({
    locale,
    area: example.engine ? 'examples' : 'playground',
    id: example.id,
  });
  return (
    <a
      className="block h-full rounded-box focus-visible:outline-2 focus-visible:outline-primary"
      href={href}
    >
      <Card className="h-full shadow-sm overflow-hidden">
        <CardSummary
          example={example}
          locale={locale}
          title={title}
          description={description}
          arrow
        />
      </Card>
    </a>
  );
}
