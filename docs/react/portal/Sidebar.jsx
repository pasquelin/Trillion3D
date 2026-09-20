import { SECTIONS } from '../../js/docsModel.js';
import { entryRoute, routeHref } from '../../js/portal/routes.js';
import { searchEntries } from '../../js/portal/search.js';
import { PrimaryNavigation } from './Header.jsx';
import { expandEntryLinks } from './entryLinks.js';

export function Sidebar({ entries, route, query, t, inputRef, onQuery, onClose }) {
  const groups = SECTIONS.map((section) => ({
    section,
    items: expandEntryLinks(
      searchEntries(entries, query).filter((entry) => entry.section === section.id),
    ),
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
          {!groups.length ? (
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
