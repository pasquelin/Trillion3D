import type { GeometryPageDescriptor } from '../../../../sdk-core/src/index.ts';
import { createSelectionResult, selectVisiblePages } from '../../page/selection/selection.ts';
import type { BackendDiagnostic } from '../types.ts';
import {
  dag,
  dagCamera,
  racine,
  type DagPage,
} from '../../../../../bench/perf/browser/support/dagCut.ts';
import { cameraMoteur } from '../../camera/camera.fixture.ts';
import { createGeometryBudget } from './pool.ts';
import { PAGE } from './pool.fixture.ts';
import type { HostCamera } from '../../camera/world.ts';

/**
 * A DAG of `PAGE`-byte pages — by default 511, only its root resident — drawn by the pool and the
 * cut as the WebGL2 frame draws them (`render.ts`): the pages an image asks for arrive before the
 * next. `primitives` cuts the pages into one selection root each, `bytes` gives each page its
 * decoded size, and `camera` the view. `rootFallback` draws a resident ancestor in place of a
 * missing page, as the forcing fallback of a DAG with its group structure does. `rootCharged`
 * leaves the root page out of the root cover the pool holds: the root cover then charges one slot
 * more than the pool, and no cut fits.
 */
export function mount(
  budgetBytes: number,
  {
    pages = dag({ feuilles: 256, seed: 11, residentes: 0 }),
    primitives = [pages],
    bytes = () => PAGE,
    camera: view,
    rootFallback = false,
    rootCharged = false,
  }: {
    pages?: DagPage[];
    primitives?: DagPage[][];
    bytes?: (url: string) => number;
    camera?: HostCamera;
    rootFallback?: boolean;
    rootCharged?: boolean;
  } = {},
) {
  const all = primitives.flat();
  const rootPages = all.filter((page) => page.parentError == null),
    root = rootPages[0];
  for (const page of rootPages) page.array ??= new Uint32Array(3);
  const byUrl = new Map(all.map((page) => [page.url, page]));
  let rootError = 0,
    views = 0;
  for (const page of all)
    if (page.parentError != null) rootError = Math.max(rootError, page.parentError);
  const state = { allocationBytes: 0 },
    kept = new Set<string>(),
    diagnostics: BackendDiagnostic[] = [];
  for (const page of byUrl.values()) if (page.array) state.allocationBytes += bytes(page.url);
  const rootBytes = rootPages.reduce((sum, page) => sum + bytes(page.url), 0);
  const pool = createGeometryBudget({
    budgetBytes,
    ceilingBytes: 1000 * Math.max(...all.map((page) => bytes(page.url))),
    descriptors: new Map(
      all.map((page) => [
        page.url,
        { uncompressedBytes: bytes(page.url) } as GeometryPageDescriptor,
      ]),
    ),
    rootUrls: new Set(rootCharged ? [] : rootPages.map((page) => page.url)),
    rootError,
    copies: {
      of: () => 1,
      root: () => rootPages.length,
      scene: () => byUrl.size,
    },
    coverRevision: () => 0,
    viewRevision: () => views,
    state,
    floorBytes: () => rootBytes,
    kept: () => kept,
    drop: (url) => {
      const page = byUrl.get(url)!;
      if (!page.array) return;
      page.array = undefined;
      state.allocationBytes -= bytes(url);
    },
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  let camera = view ?? dagCamera();
  const roots = primitives.map(racine),
    shown: DagPage[] = [];
  const cut = {
    pixelError: 0,
    viewport: [1280, 720] as [number, number],
    holdResident: true,
    rootFallback,
    slotsOf: pool.slotsOf,
    search: pool.search,
    wanted: [] as DagPage[],
    result: createSelectionResult<DagPage>(),
  };
  /** One image at the host's `pixelError`, then the pages it asked for — at most `arrivals` of
   *  them, as a streamer spreads them; returns the most the pages held meanwhile. `after` is what
   *  they held once the image trimmed them, what its frame metrics read. */
  const frame = { after: 0, stand: 0 };
  const image = (pixelError: number, arrivals = Infinity) => {
    cut.pixelError = pixelError;
    const drawn = selectVisiblePages(roots, cameraMoteur(camera), cut, shown);
    kept.clear();
    for (const page of rootPages) kept.add(page.url);
    for (const page of drawn.shown) kept.add(page.url);
    for (const page of drawn.wanted) kept.add(page.url);
    pool.trim();
    frame.after = state.allocationBytes;
    // The resident pages drawn in place of missing ones: the ancestors a refinement replaces.
    const wanted = new Set(drawn.wanted);
    frame.stand = drawn.shown.filter((page) => !wanted.has(page)).length;
    let most = state.allocationBytes,
      left = arrivals;
    for (const page of drawn.wanted)
      if (!page.array && left-- > 0) {
        page.array = new Uint32Array(3);
        state.allocationBytes += bytes(page.url);
        pool.arrived(page.url);
        most = Math.max(most, state.allocationBytes);
      }
    return most;
  };
  /** The finest threshold of the √2 ladder from 1 whose cut, budget aside, asks for the root. */
  const rootCoverAt = () => {
    const ask = { pixelError: 1, viewport: cut.viewport, holdResident: false, wanted: [] };
    while (!selectVisiblePages(roots, cameraMoteur(camera), ask, []).wanted.includes(root))
      ask.pixelError *= Math.SQRT2;
    return ask.pixelError;
  };
  /** Moves the camera `distance` units from the DAG's centre. */
  const place = (distance: number) => {
    camera = dagCamera(distance);
    views++;
  };
  return {
    pool,
    state,
    diagnostics,
    image,
    frame,
    place,
    rootCoverAt,
    drawn: () => shown.length,
  };
}
