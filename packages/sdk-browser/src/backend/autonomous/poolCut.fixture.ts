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
import { fenceAllocations, settleAllocations } from '../../webgl/core/allocation.ts';
import { createRefusalAnswer } from './refusals.ts';
import { PAGE } from './pool.fixture.ts';
import { createImageCut } from './imageCut.ts';
import { createWebglViews } from './views.ts';
import { createEngineCamera } from '../../camera/world.ts';
import { createHeldResidency } from '../../page/cut/held.ts';
import { createPageParents } from '../../residency/pageParents.ts';
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
    gl,
  }: {
    pages?: DagPage[];
    primitives?: DagPage[][];
    structures?: readonly (ClusterStructureIndex | undefined)[];
    bytes?: (url: string) => number;
    camera?: HostCamera;
    rootCharged?: boolean;
    /** The context whose refused allocations the image answers, as `render.ts`'s frame does. */
    gl?: WebGL2RenderingContext;
  } = {},
) {
  const all = primitives.flat();
  const rootPages = all.filter((page) => page.parentError == null);
  for (const page of rootPages) page.array ??= new Uint32Array(3);
  const byUrl = new Map(all.map((page) => [page.url, page]));
  const state = { allocationBytes: 0 },
    // The pool's loads and drops below move the cut's readiness, as the page store's do.
    held = createHeldResidency(),
    diagnostics: BackendDiagnostic[] = [];
  for (const page of byUrl.values()) if (page.array) state.allocationBytes += bytes(page.url);
  const roots = primitives.map((pages, i) => ({
    ...racine(pages),
    structure: structures[i],
  })) as unknown as ClusterRoot<PageRec>[];
  /** A page leaves: its geometry and bytes go, and the cut's readiness hears of it. */
  const drop = (url: string) => {
    const page = byUrl.get(url)!;
    if (!page.array) return;
    page.array = undefined;
    held.moved(page as PageRec);
    state.allocationBytes -= bytes(url);
  };
  const rootBytes = rootPages.reduce((sum, page) => sum + bytes(page.url), 0);
  // The backend's views (`views.ts`): the image reads the drawn one, the pool the others.
  const gate = { cam: createEngineCamera(), viewReplaced: () => {} },
    views = createWebglViews([1280, 720], gate, () => {}),
    { live } = views;
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
    parentsOf: createPageParents(roots),
    drop,
    others: views.others,
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  let camera = view ?? dagCamera();
  const answerRefusals = createRefusalAnswer({
    gl: () => gl,
    pool,
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    redraw: () => {},
  });
  const cut = createImageCut({ roots, view: live, revision: () => 0, pool, held });
  /** One image at the host's `pixelError`, as `render.ts` draws it, then the pages it asked for —
   *  at most `arrivals` of them, as a streamer spreads them; returns the most the pages held
   *  meanwhile. `after` is what they held once the image trimmed them, what its frame metrics
   *  read. */
  const frame = { after: 0, stand: 0 };
  let last: ReturnType<typeof cut> | undefined;
  // The order of the host's frame (`../../world/render/draw.ts`) around `render.ts`'s, copied by
  // hand: the allocations read, out of memory, readmit, trim, cut, what it keeps, the fence.
  const image = (pixelError: number, arrivals = Infinity) => {
    const { requested, shown } = live;
    settleAllocations(gl);
    answerRefusals();
    if (cut.readmit()) pool.follow(requested, shown);
    pool.trim();
    const drawn = (last = cut(cameraMoteur(camera), pixelError));
    frame.after = state.allocationBytes;
    pool.follow(requested, shown);
    // The resident pages drawn in place of missing ones: the ancestors a refinement replaces.
    const wanted = new Set(drawn.wanted);
    frame.stand = drawn.shown.filter((page) => !wanted.has(page)).length;
    let most = state.allocationBytes,
      left = arrivals;
    for (const page of requested)
      if (!page.array && left-- > 0) {
        page.array = new Uint32Array(3);
        held.moved(page as PageRec);
        state.allocationBytes += bytes(page.url);
        pool.arrived(page.url);
        most = Math.max(most, state.allocationBytes);
      }
    fenceAllocations(gl);
    return most;
  };
  /** Moves the camera `distance` units from the DAG's centre, or to the camera given. */
  const place = (at: number | HostCamera) => (camera = typeof at === 'number' ? dagCamera(at) : at);
  return {
    pool,
    state,
    /** Takes a page away as the pool evicts one — a root-cover page included. */
    drop,
    diagnostics,
    image,
    frame,
    place,
    views,
    /** What the main view asks for. */
    requested: views.main.requested,
    /** The last image's cut. */
    cut: () => last!,
    drawn: () => live.shown.length,
    wanted: () => live.desired.length,
  };
}
