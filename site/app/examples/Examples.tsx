import roadmap from '../../content/gallery-roadmap.json';
import { local } from '../../content/locale.ts';
import type { Locale } from '../../content/locale.ts';
import { routeHref } from '../portal/routes.ts';

/** The examples list: one HTML file per example, grouped by theme; an entry without a file yet
 * is named and waits. */
export function Examples({ locale }: { locale: Locale }) {
  return (
    <section data-examples>
      <h1 className="text-3xl font-bold mb-6">{locale === 'fr' ? 'Exemples' : 'Examples'}</h1>
      {roadmap.themes.map((theme) => (
        <section key={theme.id} className="mb-6">
          <h2 className="text-lg font-semibold mb-2">{local(theme.title, locale)}</h2>
          <ul className="menu menu-md p-0">
            {roadmap.entries
              .filter((entry) => entry.theme === theme.id)
              .map((entry) => (
                <li key={entry.id} className={entry.file ? '' : 'menu-disabled'}>
                  {entry.file ? (
                    <a href={routeHref({ locale, area: 'examples', id: entry.id })}>
                      {local(entry.title, locale)}
                    </a>
                  ) : (
                    <span>{local(entry.title, locale)}</span>
                  )}
                </li>
              ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
