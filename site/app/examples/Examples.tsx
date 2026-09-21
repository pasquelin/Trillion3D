import roadmap from '../../content/gallery-roadmap.json';
import { local } from '../../content/locale.ts';
import type { Locale } from '../../content/locale.ts';
import { ExampleCard } from '../gallery/ExampleCard.tsx';
import { ProgressiveList } from '../components/ProgressiveList.tsx';
import { routeHref } from '../portal/routes.ts';

/** The Examples landing page: the lessons' card grid, one card per entry of the list, theme by
 * theme — a done example with its settled render as thumbnail, opening the example; one still
 * to write greyed out, so what is done and what is not shows at a glance. */
export function Examples({ locale }: { locale: Locale }) {
  const french = locale === 'fr';
  return (
    <section data-examples>
      <h1 className="text-3xl font-bold mb-6">{french ? 'Exemples' : 'Examples'}</h1>
      <ProgressiveList
        items={roadmap.themes.flatMap((theme) =>
          roadmap.entries.filter((entry) => entry.theme === theme.id),
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
            badge={local(roadmap.themes.find(({ id }) => id === entry.theme)!.title, locale)}
            example={{
              id: entry.id,
              category: entry.theme,
              title: entry.title,
              renderer: true,
              preview: `./assets/examples/thumbnails/${entry.id}.png`,
            }}
          />
        )}
      />
    </section>
  );
}
