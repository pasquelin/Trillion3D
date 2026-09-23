import { lazy, Suspense, useEffect, useMemo } from 'react';
import { Entry } from './Entry.tsx';
import { Chapter } from './course/Chapter.tsx';
import { readyExampleIds } from './examples/list.ts';
import { resolvePage } from './portal/routes.ts';
import { ApiIndex } from './portal/ApiIndex.tsx';
import { NotFound } from './portal/NotFound.tsx';
import { Home } from './portal/Home.tsx';
import { canonicalEntryId } from './portal/entryLinks.ts';
import { useEntries } from './hooks/useEntries.ts';
import { useRoute } from './hooks/useRoute.ts';
import { PortalContext } from './layout/PortalContext.ts';
import { Shell } from './layout/Shell.tsx';
import type { PortalRoute, ResolvedPage } from './portal/routes.ts';

// The areas a route may never visit load on demand: the examples, the scene editor, the sandbox
// and its code editor, the migration guide, the reports and their presentation — none of them on
// the home page.
const AREAS = {
  examples: () => import('./examples/Examples.tsx'),
  example: () => import('./examples/Example.tsx'),
  sandbox: () => import('./sandbox/Sandbox.tsx'),
  migration: () => import('./migration/ThreeMigration.tsx'),
  editor: () => import('./editor/SceneEditor.tsx'),
  report: () => import('./reports/Report.tsx'),
};
const Examples = lazy(() => AREAS.examples().then((m) => ({ default: m.Examples })));
const Example = lazy(() => AREAS.example().then((m) => ({ default: m.Example })));
const Sandbox = lazy(() => AREAS.sandbox().then((m) => ({ default: m.Sandbox })));
const ThreeMigration = lazy(() => AREAS.migration().then((m) => ({ default: m.ThreeMigration })));
const SceneEditor = lazy(() => AREAS.editor().then((m) => ({ default: m.SceneEditor })));
const Report = lazy(() => AREAS.report().then((m) => ({ default: m.Report })));

/** Every area's chunk, fetched once the first page is up, so that no later click waits on one. */
const preloadAreas = () => Promise.all(Object.values(AREAS).map((load) => load()));

function Page({ page, route }: { page: ResolvedPage; route: PortalRoute }) {
  const { locale } = route;
  if (page.kind === 'report') return <Report route={route} />;
  if (page.kind === 'home') return <Home locale={locale} />;
  if (page.kind === 'api-index') return <ApiIndex />;
  if (page.kind === 'examples') return <Examples locale={locale} />;
  if (page.kind === 'example') return <Example id={page.id} locale={locale} />;
  if (page.kind === 'editor') return <SceneEditor />;
  if (page.kind === 'sandbox') return <Sandbox id={page.id} locale={locale} />;
  if (page.kind === 'entry' && page.entry.id === 'three-migration')
    return <ThreeMigration entry={page.entry} locale={locale} />;
  if (page.kind === 'entry' && page.entry.chapter)
    return <Chapter entry={page.entry} locale={locale} />;
  if (page.kind === 'entry') return <Entry entry={page.entry} locale={locale} />;
  return <NotFound locale={locale} />;
}

export function App() {
  const route = useRoute();
  useEffect(() => {
    const timer = setTimeout(() => void preloadAreas(), 1000);
    return () => clearTimeout(timer);
  }, []);
  const { entries, complete } = useEntries(route.locale, route.area === 'api');
  const portal = useMemo(() => {
    const id = route.area === 'api' ? canonicalEntryId(entries, route.id) : route.id;
    return { route: { ...route, id }, entries };
  }, [entries, route]);
  const page = useMemo(
    () => resolvePage(portal.route, entries, readyExampleIds),
    [portal.route, entries],
  );
  return (
    <PortalContext value={portal}>
      <Shell>
        {/* One boundary per area, whose chunk loads once; the page is keyed by its route, so
            the page that leaves is unmounted and a new one starts from its own state. */}
        <Suspense
          key={`${route.locale}/${route.area}`}
          fallback={<span className="loading loading-spinner loading-md" role="status" />}
        >
          {route.area === 'api' && !complete ? (
            <span className="loading loading-spinner loading-md" role="status" />
          ) : (
            <Page key={`${route.area}/${route.id}`} page={page} route={portal.route} />
          )}
        </Suspense>
      </Shell>
    </PortalContext>
  );
}
