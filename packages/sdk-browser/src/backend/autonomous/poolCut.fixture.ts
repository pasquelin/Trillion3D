import type { GeometryPageDescriptor } from '../../../../sdk-core/src/index.ts';
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
import { createImageCut } from './imageCut.ts';
import type { HostCamera } from '../../camera/world.ts';
import type { ClusterRoot, ClusterStructureIndex, PageRec } from '../../page/selection/types.ts';

/**
 * A DAG of `PAGE`-byte pages — by default 511, only its root resident — drawn by the pool, the cut
 * and its requests as the WebGL2 image draws them (`imageCut.ts`): the pages an image asks for
 * arrive before the next. `primitives` cuts the pages into one selection root each, with its group
 * links from `structures` when it has some; `bytes` gives each page its decoded size, and `camera`
 * the view. `rootCharged` leaves the root page out of the root cover the pool holds: the root
 * cover then charges one slot more than the pool, and nothing asked for fits.
 */
export function mount(
  budgetBytes: number,
  {
    pages = dag({ feuilles: 256, seed: 11, residentes: 0 }),
    primitives = [pages],
    structures = [],
    bytes = () => PAGE,
    camera: view,
    rootCharged = false,
  }: {
    pages?: DagPage[];
    primitives?: DagPage[][];
    structures?: readonly (ClusterStructureIndex | undefined)[];
    bytes?: (url: string) => number;
    camera?: HostCamera;
    rootCharged?: boolean;
  } = {},
) {
  const all = primitives.flat();
  const rootPages = all.filter((page) => page.parentError == null);
  for (const page of rootPages) page.array ??= new Uint32Array(3);
  const byUrl = new Map(all.map((page) => [page.url, page]));
  const state = { allocationBytes: 0 },
    kept = new Set<string>(),
    asked = new Set<string>(),
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
    copies: {
      of: () => 1,
      root: () => rootPages.length,
      scene: () => byUrl.size,
    },
    coverRevision: () => 0,
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
  const roots = primitives.map((pages, i) => ({
    ...racine(pages),
    structure: structures[i],
  })) as unknown as ClusterRoot<PageRec>[];
  const shown: PageRec[] = [],
    desired: PageRec[] = [],
    requested: PageRec[] = [];
  const cut = createImageCut({
    roots,
    viewport: [1280, 720],
    shown,
    desired,
    requested,
    revision: () => 0,
    pool,
  });
  /** One image at the host's `pixelError`, as `render.ts` draws it, then the pages it asked for —
   *  at most `arrivals` of them, as a streamer spreads them; returns the most the pages held
   *  meanwhile. `after` is what they held once the image trimmed them, what its frame metrics
   *  read. */
  const frame = { after: 0, stand: 0 };
  let last: ReturnType<typeof cut> | undefined;
  /** What the pool keeps just before a cut: the root cover and the requests (`askedUrls`). */
  const gatherAsked = () => {
    asked.clear();
    for (const page of rootPages) asked.add(page.url);
    for (const page of requested) asked.add(page.url);
  };
  // The order of `render.ts`'s frame, copied by hand: readmit, trim, cut, then what it keeps.
  const image = (pixelError: number, arrivals = Infinity) => {
    if (cut.readmit()) gatherAsked();
    pool.trim(() => asked);
    const drawn = (last = cut(cameraMoteur(camera), pixelError));
    frame.after = state.allocationBytes;
    gatherAsked();
    kept.clear();
    for (const url of asked) kept.add(url);
    for (const page of drawn.shown) kept.add(page.url);
    // The resident pages drawn in place of missing ones: the ancestors a refinement replaces.
    const wanted = new Set(drawn.wanted);
    frame.stand = drawn.shown.filter((page) => !wanted.has(page)).length;
    let most = state.allocationBytes,
      left = arrivals;
    for (const page of requested)
      if (!page.array && left-- > 0) {
        page.array = new Uint32Array(3);
        state.allocationBytes += bytes(page.url);
        pool.arrived(page.url);
        most = Math.max(most, state.allocationBytes);
      }
    return most;
  };
  /** Moves the camera `distance` units from the DAG's centre. */
  const place = (distance: number) => (camera = dagCamera(distance));
  return {
    pool,
    state,
    diagnostics,
    image,
    frame,
    place,
    requested,
    /** The last image's cut. */
    cut: () => last!,
    drawn: () => shown.length,
    wanted: () => desired.length,
  };
}
