import { useEffect, useMemo, useRef, useState } from 'react';
import { Report } from './reports/Report.tsx';
import { Entry } from './Entry.tsx';
import { EngineScene } from './engine-scene/index.tsx';
import { Gallery, Playground } from './gallery/index.tsx';
import { examples } from '../js/gallery/catalog.js';
import { rawEntries } from '../js/portal/data.js';
import { parseRoute, resolvePage, routeHref } from '../js/portal/routes.js';
import { localizeEntries, t } from '../js/i18n/index.js';
import { ApiIndex } from './portal/ApiIndex.tsx';
import { NotFound } from './portal/NotFound.tsx';
import { Home } from './portal/Home.tsx';
import { Layout } from './portal/Layout.tsx';
import { canonicalEntryId } from './portal/entryLinks.ts';
import type { PortalEntry, PortalRoute, ResolvedPage } from './types/portal.ts';

function currentRoute(): PortalRoute {
  return parseRoute(location.hash, document.documentElement.lang === 'fr' ? 'fr' : 'en');
}

function Page({
  page,
  route,
  entries,
}: {
  page: ResolvedPage;
  route: PortalRoute;
  entries: PortalEntry[];
}) {
  if (page.kind === 'report') return <Report route={route} />;
  if (page.kind === 'home') return <Home locale={route.locale} t={t} />;
  if (page.kind === 'api-index') return <ApiIndex locale={route.locale} entries={entries} t={t} />;
  if (page.kind === 'gallery') return <Gallery locale={route.locale} />;
  if (page.kind === 'engine-scene') return <EngineScene locale={route.locale} />;
  if (page.kind === 'playground') {
    return (
      <Playground
        id={page.id}
        locale={route.locale}
        onSelect={(id) => {
          location.hash = routeHref({ locale: route.locale, area: 'playground', id });
        }}
      />
    );
  }
  if (page.kind === 'entry') return <Entry entry={page.entry} locale={route.locale} />;
  return <NotFound locale={route.locale} />;
}

function readTheme(): string {
  try {
    const saved = localStorage.getItem('wg-docs-theme');
    if (saved) return saved === 'dark' ? 'dim' : saved;
  } catch {
    /* Storage may be unavailable in private contexts. */
  }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dim' : 'light';
}

export function App() {
  const [route, setRoute] = useState<PortalRoute>(currentRoute);
  const [query, setQuery] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [theme, setTheme] = useState(readTheme);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const entries: PortalEntry[] = useMemo(
    () => localizeEntries(rawEntries satisfies PortalEntry[], route.locale),
    [route.locale],
  );
  const resolvedRoute = useMemo(
    () => (route.area === 'api' ? { ...route, id: canonicalEntryId(entries, route.id) } : route),
    [entries, route],
  );
  const page = useMemo(() => {
    return resolvePage(
      resolvedRoute,
      entries,
      examples.map(({ id }: { id: string }) => id),
    ) as ResolvedPage;
  }, [resolvedRoute, entries]);

  useEffect(() => {
    const update = () => {
      setRoute(currentRoute());
      setDrawerOpen(false);
      window.scrollTo({ top: 0, behavior: 'instant' });
    };
    addEventListener('hashchange', update);
    return () => removeEventListener('hashchange', update);
  }, []);
  useEffect(() => {
    document.documentElement.lang = route.locale;
    const skip = document.querySelector('.skip-link');
    if (skip) skip.textContent = route.locale === 'fr' ? 'Aller au contenu' : 'Skip to content';
  }, [route.locale]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('wg-docs-theme', theme);
    } catch {
      /* The active theme still applies. */
    }
  }, [theme]);
  useEffect(() => {
    document.body.classList.toggle('drawer-open', drawerOpen);
    if (!drawerOpen) return () => document.body.classList.remove('drawer-open');
    const returnFocus = document.activeElement as HTMLElement | null;
    const sidebar = document.getElementById('sidebar');
    const focusable = (): HTMLElement[] =>
      sidebar
        ? [...sidebar.querySelectorAll<HTMLElement>('a, input, button, summary')].filter(
            (element) => element.getClientRects().length && !(element as HTMLInputElement).disabled,
          )
        : [];
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    addEventListener('keydown', trap);
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      document.body.classList.remove('drawer-open');
      removeEventListener('keydown', trap);
      returnFocus?.focus();
    };
  }, [drawerOpen]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
      if (
        event.key === '/' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? '')
      ) {
        event.preventDefault();
        if (matchMedia('(max-width: 900px)').matches) setDrawerOpen(true);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    };
    addEventListener('keydown', keydown);
    return () => removeEventListener('keydown', keydown);
  }, []);
  const focusSearch = () => {
    if (matchMedia('(max-width: 900px)').matches) setDrawerOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  return (
    <Layout
      entries={entries}
      route={route}
      localeRoute={resolvedRoute}
      query={query}
      t={t}
      drawerOpen={drawerOpen}
      inputRef={inputRef}
      onMenu={() => setDrawerOpen((open) => !open)}
      onClose={() => setDrawerOpen(false)}
      onSearch={focusSearch}
      onQuery={setQuery}
      onTheme={() => setTheme((value) => (value === 'dim' ? 'light' : 'dim'))}
    >
      <Page
        key={`${route.locale}/${route.area}/${route.id}`}
        page={page}
        route={route}
        entries={entries}
      />
    </Layout>
  );
}
