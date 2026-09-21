import type { JSX } from 'react';
import { Header } from './Header.tsx';
import { Sidebar } from './Sidebar.tsx';
import type { LayoutProps } from '../types/portal.ts';

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
}: LayoutProps): JSX.Element {
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
