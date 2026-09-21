import { local } from '../../content/locale.ts';
import type { Locale } from '../../content/locale.ts';
import { ExampleCard } from '../gallery/ExampleCard.tsx';
import { ProgressiveList } from '../components/ProgressiveList.tsx';
import { routeHref } from '../portal/routes.ts';
import { themedEntries } from './list.ts';

/** The Examples landing page: the lessons' card grid, one card per entry of the list, theme by
 * theme — a done example with its settled render as thumbnail, opening the example; one still
 * to write greyed out, so what is done and what is not shows at a glance. */
export function Examples({ locale }: { locale: Locale }) {
  const french = locale === 'fr';
  return (
    <section data-examples>
      <h1 className="text-3xl font-bold mb-6">{french ? 'Exemples' : 'Examples'}</h1>
      <ProgressiveList
        items={themedEntries.flatMap(({ theme, entries }) =>
          entries.map((entry) => ({ ...entry, badge: local(theme.title, locale) })),
        )}
        labels={{
          previous: french ? 'Charger les exemples précédents' : 'Load previous examples',
          next: french ? 'Charger plus d’exemples' : 'Load more examples',
          loading: french ? 'Chargement…' : 'Loading…',
          end: french ? 'Fin des exemples' : 'End of examples',
        }}
        renderItem={(entry) => (
          <ExampleCard
            key={entry.id}
            locale={locale}
            href={entry.file ? routeHref({ locale, area: 'examples', id: entry.id }) : null}
            badge={entry.badge}
            example={{
              id: entry.id,
              category: entry.theme,
              title: entry.title,
              preview: `./assets/examples/thumbnails/${entry.id}.png`,
            }}
          />
        )}
      />
    </section>
  );
}
