import { useWords } from '../i18n.ts';
import { localized } from '../../content/i18n/dictionary.ts';
import type { Locale } from '../../content/locale.ts';
import type { CatalogExample } from '../../content/catalog.ts';
import { Badge } from '../ui/Badge.tsx';
import { Card } from '../ui/Card.tsx';
import { Note } from '../ui/Text.tsx';
import { routeHref } from '../portal/routes.ts';
import { GeometryPreview } from './WebGPUCanvas.tsx';
import { themeOf } from './lessonThemes.ts';
import { local } from '../../content/locale.ts';
import type { Localized } from '../../content/locale.ts';

export const engineExample: CatalogExample = {
  id: 'engine-scene',
  category: 'streaming',
  engine: true,
  functions: ['WebGPU', 'LOD', 'streaming'],
  title: localized(({ gallery }) => gallery.engineTitle),
  description: localized(({ gallery }) => gallery.engineDescription),
};

interface PreviewProps {
  example: CardExample;
  locale: Locale;
  title: string;
}

function Preview({ example, locale, title }: PreviewProps) {
  const t = useWords(locale);
  if (example.engine)
    return (
      <img
        className="h-full w-full object-cover"
        loading="lazy"
        decoding="async"
        src="./assets/kinetic-garden/preview.png"
        alt={t('gallery.engineAlt')}
      />
    );
  if (example.renderer || example.preview)
    return (
      <img
        className="h-full w-full object-cover"
        loading="lazy"
        decoding="async"
        src={example.preview ?? './assets/kinetic-garden/preview.png'}
        alt={t('gallery.previewAlt')}
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
  const t = useWords(locale);
  const title = local(example.title, locale);
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
          {badge ?? (example.engine ? t('gallery.engineBadge') : t(`themes.${themeOf(example)}`))}
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
  const t = useWords(locale);
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
          {t('examples.inProgress')}
        </Badge>
        <h2 className="card-title text-lg">{title}</h2>
        {missing && <Note>{`${t('examples.waitsFor')} ${missing}`}</Note>}
      </Card>
    </div>
  );
}
