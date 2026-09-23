import { lazy, Suspense, useEffect, useMemo } from 'react';
import { Entry } from './Entry.tsx';
import { EngineExample } from './engine-scene/index.tsx';
import { examples as lessons } from '../content/catalog.ts';
import { readyExampleIds } from './examples/list.ts';
import { rawEntries } from './portal/data.ts';
import { resolvePage, routeHref } from './portal/routes.ts';
import { localizeEntries } from '../content/i18n/index.ts';
import { ApiIndex } from './portal/ApiIndex.tsx';
import { NotFound } from './portal/NotFound.tsx';
import { Home } from './portal/Home.tsx';
import { canonicalEntryId } from './portal/entryLinks.ts';
import { useRoute } from './hooks/useRoute.ts';
import { PortalContext } from './layout/PortalContext.ts';
import { Shell } from './layout/Shell.tsx';
import type { PortalEntry } from '../content/model.ts';
import type { PortalRoute, ResolvedPage } from './portal/routes.ts';

// The areas a route may never visit load on demand: the examples, the lessons gallery, the
// lessons and their code editor, the reports and their presentation — none of them on the home
// page.
const Gallery = lazy(() => import('./gallery/Gallery.tsx').then((m) => ({ default: m.Gallery })));
const Examples = lazy(() =>
  import('./examples/Examples.tsx').then((m) => ({ default: m.Examples })),
);
const Example = lazy(() => import('./examples/Example.tsx').then((m) => ({ default: m.Example })));
const Playground = lazy(() =>
  import('./gallery/Playground.tsx').then((m) => ({ default: m.Playground })),
);
const Report = lazy(() => import('./reports/Report.tsx').then((m) => ({ default: m.Report })));

const LESSON_IDS = lessons.map(({ id }) => id);

/** Every area's chunk, fetched once the first page is up, so that no later click waits on one. */
const preloadAreas = () =>
  Promise.all([
    import('./gallery/Gallery.tsx'),
    import('./examples/Examples.tsx'),
    import('./examples/Example.tsx'),
    import('./gallery/Playground.tsx'),
    import('./reports/Report.tsx'),
  ]);

function Page({ page, route }: { page: ResolvedPage; route: PortalRoute }) {
  const { locale } = route;
  if (page.kind === 'report') return <Report route={route} />;
  if (page.kind === 'home') return <Home locale={locale} />;
  if (page.kind === 'api-index') return <ApiIndex />;
  if (page.kind === 'examples') return <Examples locale={locale} />;
  if (page.kind === 'example') return <Example id={page.id} locale={locale} />;
  if (page.kind === 'gallery') return <Gallery locale={locale} />;
  if (page.kind === 'engine-scene') return <EngineExample locale={locale} />;
  if (page.kind === 'lesson') {
    const open = (id: string) => {
      location.hash = routeHref({ locale, area: 'lessons', id });
    };
    return <Playground id={page.id} locale={locale} onSelect={open} />;
  }
  if (page.kind === 'entry') return <Entry entry={page.entry} locale={locale} />;
  return <NotFound locale={locale} />;
}

export function App() {
  const route = useRoute();
  useEffect(() => {
    const timer = setTimeout(() => void preloadAreas(), 1000);
    return () => clearTimeout(timer);
  }, []);
  const entries: PortalEntry[] = useMemo(
    () => localizeEntries(rawEntries, route.locale),
    [route.locale],
  );
  const portal = useMemo(() => {
    const id = route.area === 'api' ? canonicalEntryId(entries, route.id) : route.id;
    return { route: { ...route, id }, entries };
  }, [entries, route]);
  const page = useMemo(
    () => resolvePage(portal.route, entries, LESSON_IDS, readyExampleIds),
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
          <Page key={`${route.area}/${route.id}`} page={page} route={portal.route} />
        </Suspense>
      </Shell>
    </PortalContext>
  );
}
