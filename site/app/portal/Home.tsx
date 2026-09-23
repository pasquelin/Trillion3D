import { t } from '../../content/i18n/index.ts';
import { local } from '../../content/locale.ts';
import type { Locale } from '../../content/locale.ts';
import { readyEntries, thumbnailOf } from '../examples/list.ts';
import { DocPage, SITE_NAME } from '../layout/DocPage.tsx';
import { LinkButton } from '../ui/Button.tsx';
import { Mosaic } from '../ui/Mosaic.tsx';
import { routeHref } from './routes.ts';

/** The flagships, shown large, one per band of the mosaic. */
const FLAGSHIPS = [
  'a-ring-of-lamps',
  'glass-on-the-table',
  'orbit-around-a-clockwork',
  'walk-through-a-temple',
  'spin-an-astrolabe',
  'a-terrain-from-a-height-map',
];

/** Examples kept off the home while a defect of the engine shows in them. */
const HELD_BACK = ['a-robot-that-walks-and-waves'];

/** The home is the gallery: one line on what the engine does, where to start, then every ready
 * example as a picture that opens it — the flagships large. */
export function Home({ locale }: { locale: Locale }) {
  const shown = readyEntries.filter(({ id }) => !HELD_BACK.includes(id));
  // Each flagship, then four of the others: a large tile and the four small ones beside it
  // fill one band of the mosaic.
  const others = shown.filter(({ id }) => !FLAGSHIPS.includes(id));
  const ordered = [
    ...FLAGSHIPS.flatMap((id, index) => [
      ...shown.filter((entry) => entry.id === id),
      ...others.slice(index * 4, index * 4 + 4),
    ]),
    ...others.slice(FLAGSHIPS.length * 4),
  ];
  return (
    <DocPage
      title={SITE_NAME}
      lead={t(locale, 'home.title')}
      actions={
        <>
          <LinkButton
            variant="primary"
            href={routeHref({ locale, area: 'learn', id: 'quick-start' })}
          >
            {t(locale, 'home.start')}
          </LinkButton>
          <LinkButton variant="outline" href={routeHref({ locale, area: 'api', id: '' })}>
            {t(locale, 'nav.api')}
          </LinkButton>
        </>
      }
    >
      <Mosaic
        tiles={ordered.map((entry) => ({
          id: entry.id,
          href: routeHref({ locale, area: 'examples', id: entry.id }),
          src: thumbnailOf(entry.id),
          label: local(entry.title, locale),
          large: FLAGSHIPS.includes(entry.id),
        }))}
      />
    </DocPage>
  );
}
