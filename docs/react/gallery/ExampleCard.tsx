import type { Locale } from '../types/portal.ts';
import type { CatalogExample, GalleryExample, RoadmapExample } from '../types/gallery.ts';
import { Alert, Card } from '../components/UI.tsx';
import { CodeBlock } from '../components/CodeBlock.tsx';
import { routeHref } from '../../js/portal/routes.js';
import { GeometryPreview } from './WebGPUCanvas.tsx';
import { planCode } from './roadmapPlan.ts';
import { relatedReadyLesson } from './roadmapRelated.ts';
import { themeLabel, themeOf } from './roadmapThemes.ts';
import { local } from './localized.ts';

export const engineExample: CatalogExample = {
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

interface PreviewProps {
  example: GalleryExample;
  locale: Locale;
  title: string;
}

function Preview({ example, locale, title }: PreviewProps) {
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
  if (example.renderer)
    return (
      <img
        className="h-full w-full object-cover"
        src={example.preview ?? './assets/kinetic-garden/preview.png'}
        alt={locale === 'fr' ? 'Aperçu de la scène WebGPU' : 'WebGPU scene preview'}
      />
    );
  return (
    <GeometryPreview id={example.id} locale={locale} interactive={false} label={`${title} — 3D`} />
  );
}

interface CardSummaryProps extends PreviewProps {
  description: string;
  arrow?: boolean;
}

function CardSummary({ example, locale, title, description, arrow = false }: CardSummaryProps) {
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
            : themeLabel(themeOf(example), locale)}
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

function PlannedDetails({ example, locale }: { example: RoadmapExample; locale: Locale }) {
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

interface ExampleCardProps {
  example: GalleryExample;
  locale?: Locale;
  expanded?: boolean;
  onOpen?: (id: string) => void;
}

export function ExampleCard({
  example,
  locale = 'en',
  expanded = false,
  onOpen,
}: ExampleCardProps) {
  const title = local(example.title, locale),
    description = example.description
      ? local(example.description, locale)
      : local(example.concept, locale);
  if (example.status === 'planned')
    return (
      <Card className="h-full shadow-sm overflow-hidden">
        <button
          type="button"
          className="grid gap-4 text-left rounded-box focus-visible:outline-2 focus-visible:outline-primary"
          aria-expanded={expanded}
          onClick={() => onOpen?.(example.id)}
        >
          <CardSummary example={example} locale={locale} title={title} description={description} />
        </button>
        {expanded && <PlannedDetails example={example} locale={locale} />}
      </Card>
    );
  const href = routeHref({
    locale,
    area: example.engine ? 'examples' : 'playground',
    id: example.readyLessonId ?? example.id,
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
