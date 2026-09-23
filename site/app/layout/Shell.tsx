import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { t } from '../../content/i18n/index.ts';
import { useDrawer } from '../hooks/useDrawer.ts';
import { useSearchShortcut } from '../hooks/useSearchShortcut.ts';
import { Header } from './Header.tsx';
import { usePortal } from './PortalContext.ts';
import { SearchModal } from './SearchModal.tsx';
import { Sidebar } from './Sidebar.tsx';

/** The frame of every page, the height of the screen: the header, then the sidebar of the current
 * area and the page, each scrolling on its own; the site search over them. */
export function Shell({ children }: { children: ReactNode }) {
  const { route } = usePortal();
  const drawer = useDrawer();
  const [searching, setSearching] = useState(false);
  const openSearch = useCallback(() => setSearching(true), []);
  useSearchShortcut(openSearch);
  const main = useRef<HTMLElement | null>(null);
  // A new page opens at its top: the content area is what scrolls, never the window.
  useEffect(() => {
    // A block: `scrollTo` returns a promise in current browsers, which an effect must not return.
    main.current?.scrollTo({ top: 0, behavior: 'instant' });
  }, [route]);
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[100] focus:rounded-box focus:bg-base-100 focus:p-3"
        href="#main-content"
        onClick={(event) => {
          // The hash names routes: the link moves the focus instead of the address.
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        {t(route.locale, 'actions.skip')}
      </a>
      <Header drawerOpen={drawer.open} onMenu={drawer.toggle} onSearch={openSearch} />
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Sidebar open={drawer.open} panel={drawer.panel} onClose={drawer.close} />
        <main
          ref={main}
          id="main-content"
          tabIndex={-1}
          className="min-h-0 min-w-0 overflow-y-auto p-4 outline-none sm:p-6"
        >
          {children}
        </main>
      </div>
      <SearchModal open={searching} onClose={() => setSearching(false)} />
    </div>
  );
}
