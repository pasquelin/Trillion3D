import type { Locale } from '../../content/locale.ts';
import type { CatalogExample } from '../../content/catalog.ts';
import { Card } from '../components/UI.tsx';
import { routeHref } from '../portal/routes.ts';
import { GeometryPreview } from './WebGPUCanvas.tsx';
import { themeLabel, themeOf } from './lessonThemes.ts';
import { local } from '../../content/locale.ts';

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
  example: CatalogExample;
  locale: Locale;
  title: string;
}

function Preview({ example, locale, title }: PreviewProps) {
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

export function ExampleCard({
  example,
  locale = 'en',
}: {
  example: CatalogExample;
  locale?: Locale;
}) {
  const french = locale === 'fr',
    title = local(example.title, locale);
  const href = routeHref({
    locale,
    area: example.engine ? 'lessons' : 'playground',
    id: example.id,
  });
  return (
    <a
      className="block h-full rounded-box focus-visible:outline-2 focus-visible:outline-primary"
      href={href}
    >
      <Card className="h-full shadow-sm overflow-hidden">
        <div className="gallery-preview rounded-box overflow-hidden bg-base-300">
          <Preview example={example} locale={locale} title={title} />
        </div>
        <span className="badge badge-soft badge-primary">
          {example.engine
            ? french
              ? 'Scène moteur'
              : 'Engine scene'
            : themeLabel(themeOf(example), locale)}
        </span>
        <h2 className="card-title text-lg">{title}</h2>
        <p className="text-sm opacity-75 grow">{local(example.description, locale)}</p>
        <span className="self-end text-primary text-xl" aria-hidden="true">
          →
        </span>
      </Card>
    </a>
  );
}
