import { Header } from './Header.tsx';
import { Sidebar } from './Sidebar.tsx';
import type { ReactNode, RefObject } from 'react';
import type { PortalEntry } from '../../content/model.ts';
import type { PortalRoute } from './routes.ts';
import type { TranslateFn } from '../../content/i18n/index.ts';

interface LayoutProps {
  children: ReactNode;
  entries: PortalEntry[];
  route: PortalRoute;
  localeRoute?: PortalRoute;
  query: string;
  t: TranslateFn;
  drawerOpen: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onMenu: () => void;
  onClose: () => void;
  onSearch: () => void;
  onQuery: (query: string) => void;
  onTheme: () => void;
}

export function Layout({
  children,
  entries,
  route,
  localeRoute = route,
  query,
  t,
  drawerOpen,
  inputRef,
  onMenu,
  onClose,
  onSearch,
  onQuery,
  onTheme,
}: LayoutProps) {
  return (
    <>
      <Header
        locale={route.locale}
        route={localeRoute}
        t={t}
        drawerOpen={drawerOpen}
        onMenu={onMenu}
        onSearch={onSearch}
        onTheme={onTheme}
      />
      <div className="portal-layout">
        <Sidebar
          entries={entries}
          route={route}
          query={query}
          t={t}
          inputRef={inputRef}
          onQuery={onQuery}
          onClose={onClose}
        />
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </>
  );
}
