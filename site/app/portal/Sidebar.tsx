import { ReportNavigation } from '../reports/Navigation.tsx';
import { SECTIONS } from '../../content/model.ts';
import { entryRoute, routeHref } from './routes.ts';
import { searchEntries } from './search.ts';
import { PrimaryNavigation } from './Header.tsx';
import { expandEntryLinks } from './entryLinks.ts';
import type { RefObject } from 'react';
import type { PortalEntry } from '../../content/model.ts';
import type { PortalRoute } from './routes.ts';
import type { TranslateFn } from '../../content/i18n/index.ts';

interface SidebarProps {
  entries: PortalEntry[];
  route: PortalRoute;
  query: string;
  t: TranslateFn;
  inputRef: RefObject<HTMLInputElement | null>;
  onQuery: (query: string) => void;
  onClose: () => void;
}

export function Sidebar({ entries, route, query, t, inputRef, onQuery, onClose }: SidebarProps) {
  const matches = searchEntries(entries, query);
  const groups = SECTIONS.map((section) => ({
    section,
    items: expandEntryLinks(matches.filter((entry) => entry.section === section.id)),
  })).filter(({ items }) => items.length);

  return (
    <>
      <aside className="sidebar" id="sidebar" aria-label={t(route.locale, 'sidebar.navigation')}>
        <PrimaryNavigation
          locale={route.locale}
          activeArea={route.area}
          t={t}
          mobile
          onNavigate={onClose}
        />
        <div className="sidebar-search">
          <label className="sr-only" htmlFor="search-input">
            {t(route.locale, 'search.label')}
          </label>
          <input
            ref={inputRef}
            className="input input-bordered w-full"
            id="search-input"
            type="search"
            autoComplete="off"
            value={query}
            placeholder={t(route.locale, 'search.placeholder')}
            onChange={(event) => onQuery(event.target.value)}
          />
        </div>
        <nav>
          {route.area === 'reports' && !query ? (
            <ReportNavigation route={route} onClose={onClose} />
          ) : !groups.length ? (
            <p className="empty-search" role="status">
              {t(route.locale, 'sidebar.noResults')}
            </p>
          ) : (
            <ul className="menu menu-md w-full p-0">
              {groups.map(({ section, items }) => (
                <li key={section.id}>
                  <details open={query ? true : undefined}>
                    <summary>
                      <span className="sidebar-section-title">
                        {t(route.locale, `section.${section.id}`)}
                      </span>
                      <span className="sidebar-count">{items.length}</span>
                    </summary>
                    <ul>
                      {items.map(({ entry, key, label, primary, id }) => {
                        const active = id === route.id || (entry.id === route.id && primary);
                        return (
                          <li key={key}>
                            <a
                              className={active ? 'menu-active' : ''}
                              href={
                                id === entry.id
                                  ? entryRoute(entry, route.locale)
                                  : routeHref({ locale: route.locale, area: 'api', id })
                              }
                              aria-current={active ? 'page' : undefined}
                              onClick={onClose}
                            >
                              <span>{label}</span>
                              {entry.issue ? (
                                <span
                                  className="status-dot"
                                  title={t(route.locale, 'common.inDevelopment')}
                                />
                              ) : null}
                            </a>
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </nav>
      </aside>
      <button
        className="drawer-backdrop"
        type="button"
        aria-label={t(route.locale, 'actions.closeMenu')}
        onClick={onClose}
      />
    </>
  );
}
