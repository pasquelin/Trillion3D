import { AREAS, routeHref } from './routes.ts';
import { Button } from '../components/UI.tsx';
import type { Locale } from '../../content/locale.ts';
import type { PortalRoute, RouteArea } from './routes.ts';
import type { TranslateFn } from '../../content/i18n/index.ts';

function navRoute(locale: Locale, area: RouteArea): PortalRoute {
  return {
    locale,
    area,
    id: area === 'learn' ? 'home' : area === 'playground' ? 'compose-transform' : '',
  };
}

interface PrimaryNavigationProps {
  locale: Locale;
  activeArea?: RouteArea;
  t: TranslateFn;
  mobile?: boolean;
  onNavigate?: () => void;
}

export function PrimaryNavigation({
  locale,
  activeArea,
  t,
  mobile = false,
  onNavigate,
}: PrimaryNavigationProps) {
  return (
    <nav
      className={mobile ? 'mobile-primary' : 'top-nav'}
      aria-label={locale === 'fr' ? 'Navigation principale' : 'Primary navigation'}
    >
      {AREAS.map((area) => (
        <a
          key={area}
          data-nav={area}
          href={routeHref(navRoute(locale, area))}
          aria-current={activeArea === area ? 'page' : undefined}
          onClick={onNavigate}
        >
          {t(locale, `nav.${area}`)}
        </a>
      ))}
    </nav>
  );
}

interface HeaderProps {
  locale: Locale;
  route: PortalRoute;
  t: TranslateFn;
  drawerOpen: boolean;
  onMenu: () => void;
  onSearch: () => void;
  onTheme: () => void;
}

export function Header({ locale, route, t, drawerOpen, onMenu, onSearch, onTheme }: HeaderProps) {
  const home = routeHref({ locale, area: 'learn', id: 'home' });
  return (
    <header className="site-header">
      <Button
        variant="ghost"
        className="icon-button menu-button"
        aria-controls="sidebar"
        aria-expanded={drawerOpen}
        aria-label={t(locale, drawerOpen ? 'actions.closeMenu' : 'actions.openMenu')}
        onClick={onMenu}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </Button>
      <a className="brand" href={home}>
        <span className="brand-mark">WG</span>
        <span>Web Geometry</span>
      </a>
      <PrimaryNavigation locale={locale} activeArea={route.area} t={t} />
      <div className="header-actions">
        <Button
          variant="ghost"
          className="search-button"
          aria-label={t(locale, 'search.label')}
          onClick={onSearch}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" />
          </svg>
          <span>{t(locale, 'search.placeholder')}</span>
          <kbd>/</kbd>
        </Button>
        <a
          className="locale-button"
          href={routeHref({ ...route, locale: locale === 'en' ? 'fr' : 'en' })}
        >
          {locale === 'en' ? 'FR' : 'EN'}
          <span className="sr-only">{t(locale, 'actions.switchLanguage')}</span>
        </a>
        <Button
          variant="ghost"
          className="icon-button"
          aria-label={t(locale, 'actions.theme')}
          onClick={onTheme}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.64 5.64l1.42 1.42m9.88 9.88 1.42 1.42m0-12.72-1.42 1.42M7.06 16.94l-1.42 1.42M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" />
          </svg>
        </Button>
      </div>
    </header>
  );
}
