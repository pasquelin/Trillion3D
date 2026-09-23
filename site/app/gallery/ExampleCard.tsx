import type { Locale } from '../../content/locale.ts';
import type { CatalogExample } from '../../content/catalog.ts';
import { Badge } from '../ui/Badge.tsx';
import { Card } from '../ui/Card.tsx';
import { Note } from '../ui/Text.tsx';
import { t } from '../../content/i18n/index.ts';
import { routeHref } from '../portal/routes.ts';
import { GeometryPreview } from './WebGPUCanvas.tsx';
import { themeLabel, themeOf } from './lessonThemes.ts';
import { local } from '../../content/locale.ts';
import type { Localized } from '../../content/locale.ts';

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
  example: CardExample;
  locale: Locale;
  title: string;
}

function Preview({ example, locale, title }: PreviewProps) {
  if (example.engine)
    return (
      <img
        className="h-full w-full object-cover"
        loading="lazy"
        decoding="async"
        src="./assets/kinetic-garden/preview.png"
        alt={
          locale === 'fr'
            ? 'Jardin géométrique rendu par WebGPU'
            : 'Geometry garden rendered by WebGPU'
        }
      />
    );
  if (example.renderer || example.preview)
    return (
      <img
        className="h-full w-full object-cover"
        loading="lazy"
        decoding="async"
        src={example.preview ?? './assets/kinetic-garden/preview.png'}
        alt={locale === 'fr' ? 'Aperçu de la scène WebGPU' : 'WebGPU scene preview'}
      />
    );
  return (
    <GeometryPreview id={example.id} locale={locale} interactive={false} label={`${title} — 3D`} />
  );
}

/** A card's example: a lesson of the catalogue, or an example of the Examples area, which has no
 * description and names its own route and badge. */
type CardExample = Omit<CatalogExample, 'description'> & { description?: Localized };

interface ExampleCardProps {
  example: CardExample;
  locale?: Locale;
  /** The card's route; a lesson's by default. */
  href?: string;
  badge?: string;
}

export function ExampleCard({ example, locale = 'en', href, badge }: ExampleCardProps) {
  const title = local(example.title, locale);
  const engineBadge = locale === 'fr' ? 'Scène moteur' : 'Engine scene';
  return (
    <a
      className="block h-full rounded-box focus-visible:outline-2 focus-visible:outline-primary"
      href={href ?? routeHref({ locale, area: 'lessons', id: example.id })}
    >
      <Card className="h-full overflow-hidden shadow-sm">
        <div className="aspect-[16/10] overflow-hidden rounded-box bg-base-300">
          <Preview example={example} locale={locale} title={title} />
        </div>
        <Badge tone="primary" soft>
          {badge ?? (example.engine ? engineBadge : themeLabel(themeOf(example), locale))}
        </Badge>
        <h2 className="card-title text-lg">{title}</h2>
        {example.description && (
          <p className="grow text-sm opacity-75">{local(example.description, locale)}</p>
        )}
        <span className="self-end text-xl text-primary" aria-hidden="true">
          →
        </span>
      </Card>
    </a>
  );
}

interface PendingProps {
  title: string;
  locale: Locale;
  /** The engine feature the example waits for, when it waits for one. */
  missing?: string;
}

/** An example still to come: its title, "in progress", and — when it waits for the engine — the
 * feature it waits for. It opens nothing. */
export function PendingExampleCard({ title, locale, missing }: PendingProps) {
  return (
    <div aria-disabled="true" className="h-full opacity-75">
      <Card className="h-full overflow-hidden shadow-sm">
        <img
          className="aspect-[16/10] w-full rounded-box object-cover"
          src="./assets/example-in-progress.svg"
          alt=""
          loading="lazy"
        />
        <Badge tone="info" soft>
          {t(locale, 'examples.inProgress')}
        </Badge>
        <h2 className="card-title text-lg">{title}</h2>
        {missing && <Note>{`${t(locale, 'examples.waitsFor')} ${missing}`}</Note>}
      </Card>
    </div>
  );
}
