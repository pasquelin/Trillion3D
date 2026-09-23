import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { t } from '../../content/i18n/index.ts';
import { SearchInput } from '../ui/Input.tsx';
import { PrimaryNavigation } from './Header.tsx';
import { apiMenu, examplesMenu, learnMenu, reportMenu } from './menus.ts';
import { usePortal } from './PortalContext.ts';
import { ExampleList } from './ExampleList.tsx';
import { SidebarMenu } from './SidebarMenu.tsx';

/** The Examples sidebar: a filter box over the ready examples, theme by theme. */
function ExamplesMenu() {
  const { route } = usePortal();
  const [query, setQuery] = useState('');
  const groups = examplesMenu(route, query);
  return (
    <>
      <div className="sticky -top-4 z-10 -mx-4 -mt-4 mb-2 bg-base-200 p-4">
        <SearchInput
          value={query}
          placeholder={t(route.locale, 'sidebar.filterExamples')}
          aria-label={t(route.locale, 'sidebar.filterExamples')}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {groups.length > 0 ? (
        <ExampleList groups={groups} />
      ) : (
        <p className="p-2 text-sm opacity-70" role="status">
          {t(route.locale, 'sidebar.noResults')}
        </p>
      )}
    </>
  );
}

/** The menu of the current area: each area has its own. */
function AreaMenu() {
  const { route, entries } = usePortal();
  if (route.area === 'examples') return <ExamplesMenu />;
  if (route.area === 'reports') return <SidebarMenu groups={reportMenu(route)} />;
  if (route.area === 'api') return <SidebarMenu groups={apiMenu(entries, route)} />;
  return <SidebarMenu groups={learnMenu(entries, route)} />;
}

interface SidebarProps {
  open: boolean;
  panel: RefObject<HTMLElement | null>;
  onClose: () => void;
}

/** The sidebar: a column the height of the page on wide screens, whose menu stays in view as the
 * page scrolls; a drawer over the page on narrow ones, with the areas at its top. */
export function Sidebar({ open, panel, onClose }: SidebarProps) {
  const { route } = usePortal();
  // The current page's entry comes into view, in the sidebar's own scroll only.
  useEffect(() => {
    const aside = panel.current;
    const current = aside?.querySelector('[aria-current="page"]');
    if (!aside || !current) return;
    const box = aside.getBoundingClientRect();
    const item = current.getBoundingClientRect();
    if (item.top < box.top || item.bottom > box.bottom)
      aside.scrollTop += item.top - box.top - box.height / 3;
  }, [panel, route]);
  return (
    <div className="contents lg:block lg:min-h-0 lg:border-r lg:border-base-300 lg:bg-base-200">
      <aside
        ref={panel}
        id="sidebar"
        aria-label={t(route.locale, 'sidebar.navigation')}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('a')) onClose();
        }}
        className={`fixed bottom-0 left-0 top-16 z-50 w-[min(20rem,88vw)] overflow-x-hidden overflow-y-auto bg-base-200 p-4 shadow-xl transition-transform lg:static lg:z-auto lg:h-full lg:w-auto lg:translate-x-0 lg:shadow-none lg:visible ${open ? 'translate-x-0' : 'invisible -translate-x-full'}`}
      >
        <PrimaryNavigation drawer />
        <AreaMenu key={route.area} />
      </aside>
      {open && (
        <button
          type="button"
          className="fixed inset-0 top-16 z-40 bg-black/50 lg:hidden"
          aria-label={t(route.locale, 'actions.closeMenu')}
          onClick={onClose}
        />
      )}
    </div>
  );
}
