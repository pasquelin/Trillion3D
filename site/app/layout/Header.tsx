import { t } from '../../content/i18n/index.ts';
import { useTheme } from '../hooks/useTheme.ts';
import { Button, LinkButton, NavLink } from '../ui/Button.tsx';
import { Icon } from '../ui/Icon.tsx';
import { navLinks, routeHref } from '../portal/routes.ts';
import { usePortal } from './PortalContext.ts';

/** The header's areas, as a bar on wide screens and as a grid at the top of the drawer; the
 * current one active. */
export function PrimaryNavigation({ drawer = false }: { drawer?: boolean }) {
  const { route } = usePortal();
  return (
    <nav
      className={
        drawer ? 'mb-4 grid grid-cols-2 gap-2 lg:hidden' : 'hidden items-center gap-1 lg:flex'
      }
      aria-label={t(route.locale, 'nav.primary')}
    >
      {navLinks(route).map(({ area, href, current }) => (
        <NavLink
          key={area}
          data-nav={area}
          current={current}
          className={drawer ? 'text-center' : current ? '' : 'text-neutral-content'}
          href={href}
        >
          {t(route.locale, `nav.${area}`)}
        </NavLink>
      ))}
    </nav>
  );
}

interface HeaderProps {
  drawerOpen: boolean;
  onMenu: () => void;
  onSearch: () => void;
}

/** The site header: the menu button on narrow screens, the brand, the areas, then the search,
 * the language and the theme. */
export function Header({ drawerOpen, onMenu, onSearch }: HeaderProps) {
  const { route } = usePortal();
  const toggleTheme = useTheme();
  const { locale } = route;
  const other = locale === 'en' ? 'fr' : 'en';
  return (
    <header className="relative z-40 flex h-16 shrink-0 items-center gap-2 border-b border-base-300 bg-neutral px-3 text-neutral-content sm:gap-4 sm:px-6">
      <Button
        circle
        className="text-neutral-content lg:hidden"
        aria-controls="sidebar"
        aria-expanded={drawerOpen}
        aria-label={t(locale, drawerOpen ? 'actions.closeMenu' : 'actions.openMenu')}
        onClick={onMenu}
      >
        <Icon name="menu" />
      </Button>
      <a
        className="flex items-center gap-3 whitespace-nowrap font-bold"
        href={routeHref({ locale, area: 'learn', id: 'home' })}
      >
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary font-mono text-xs text-primary-content">
          WG
        </span>
        <span className="hidden sm:inline">Web Geometry</span>
      </a>
      <PrimaryNavigation />
      <div className="ml-auto flex items-center gap-2">
        <Button
          className="flex-nowrap whitespace-nowrap border-neutral-content/20 text-neutral-content md:w-44 md:justify-start"
          variant="outline"
          aria-label={t(locale, 'search.placeholder')}
          onClick={onSearch}
        >
          <Icon name="search" />
          <span className="hidden min-w-0 flex-1 truncate text-left font-normal opacity-75 md:inline">
            {t(locale, 'search.short')}
          </span>
          <kbd className="kbd kbd-sm text-base-content">/</kbd>
        </Button>
        <LinkButton
          className="font-mono text-neutral-content"
          href={routeHref({ ...route, locale: other })}
          hrefLang={other}
        >
          {other.toUpperCase()}
          <span className="sr-only">{t(locale, 'actions.switchLanguage')}</span>
        </LinkButton>
        <Button
          circle
          className="text-neutral-content"
          aria-label={t(locale, 'actions.theme')}
          onClick={toggleTheme}
        >
          <Icon name="theme" />
        </Button>
      </div>
    </header>
  );
}
