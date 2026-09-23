import type { GeometryPageDescriptor } from '../../../../sdk-core/src/index.ts';
import type { MemoryBudgets, MemoryBudgetsReport } from '../../webgpu/pages/io/memory.ts';
import type { BackendContext } from '../types.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import type { DecodedGeometryPage } from '../../page/decode/geometryPage.ts';
import type { WebglFrameGate } from '../../webgl/core/frameGate.ts';
import type { createAutonomousGeometry } from './geometry.ts';
import { comptePagesResidentes, type createAutonomousResidency } from './residency.ts';
import {
  DEFAULT_GEOMETRY_POOL_BUDGET,
  geometryPoolFor,
  type GeometryPool,
} from '../../webgpu/residency/memoryBudgets.ts';
import { evictOldest } from '../../streaming/evictOldest.ts';

type PoolEnvironment = {
  /** The host's budget, `DEFAULT_GEOMETRY_POOL_BUDGET` when it names none. */
  budgetBytes?: number;
  descriptors: ReadonlyMap<string, GeometryPageDescriptor>;
  /** Pages of the root cover, which the pool never goes below. */
  rootPages: number;
  /** Decoded bytes the pages hold, which the geometry store keeps. */
  state: { readonly allocationBytes: number };
  /** Pages the frame keeps: the root cover, the host's own, the cut drawn and the cut wanted. */
  kept: () => readonly string[];
  /** Gives a page's geometry back; a kept page is never named. */
  drop: (url: string) => void;
};

/**
 * The WebGL2 geometry pool: the same fixed budget in bytes as the WebGPU pool, drawn by the same
 * rule (`geometryPoolFor`) — slots of the catalogue's largest decoded page, the root cover always
 * held. The slots bound the cut (`pageBudget`), which draws coarser when the view does not fit;
 * the bytes bound what stays resident: when the pages hold more than the budget, those no frame
 * keeps leave oldest first, as the page streamer's cache evicts (`evictOldest`). A page the cut
 * draws is never evicted, so the image never shows a hole: a shrink takes effect as the coarser
 * cut arrives. Under the budget, nothing is walked: an arrival costs a set insertion, a frame one
 * comparison.
 */
export function createGeometryBudget(env: PoolEnvironment) {
  const { descriptors, rootPages, state, kept, drop } = env;
  // A page's decoded size is the bytes it holds resident: its indices and its float attributes.
  let pageBytes = 1;
  for (const descriptor of descriptors.values())
    pageBytes = Math.max(pageBytes, descriptor.uncompressedBytes);
  const poolFor = (budgetBytes: number) =>
    geometryPoolFor({ budgetBytes, pageBytes, uniquePages: descriptors.size, rootPages });
  let pool = poolFor(env.budgetBytes ?? DEFAULT_GEOMETRY_POOL_BUDGET),
    rootBytes = 0;
  // Resident pages, oldest first; an eviction pass moves the kept ones to the end.
  const order = new Set<string>(),
    keep = new Set<string>();
  const over = () => state.allocationBytes > Math.max(pool.budgetBytes, rootBytes);
  const evictOne = (url: string) => {
    order.delete(url);
    drop(url);
  };
  const trim = () => {
    if (!over()) return 0;
    keep.clear();
    for (const url of kept()) {
      keep.add(url);
      if (order.delete(url)) order.add(url);
    }
    return evictOldest(order, over, (url) => keep.has(url), evictOne);
  };
  return {
    /** The pool as drawn from the budget; its `allocatedBytes` is the most it may hold. */
    get held(): GeometryPool {
      return pool;
    },
    /** The pool as it stands, for a report: `allocatedBytes` is what the pages hold. */
    report(): GeometryPool {
      return { ...pool, allocatedBytes: state.allocationBytes };
    },
    /** Pages the cut may draw: the budget in the catalogue's largest page, or 0 — no bound — when
     *  every page of the scene fits: records drawn from one page then count once each. */
    get cutPages() {
      return pool.clamp === 'scene' ? 0 : pool.slots;
    },
    /** The root cover has arrived: its bytes are the floor the pool never goes below. */
    rooted() {
      rootBytes = state.allocationBytes;
    },
    /** A page has arrived: it enters the order, and the pool sheds what no frame keeps. */
    arrived(url: string) {
      order.add(url);
      trim();
    },
    /** A page left by another way — the streamer evicted it. */
    left(url: string) {
      order.delete(url);
    },
    /** Sheds what the last cut left, once over the budget; returns the pages evicted. */
    trim,
    /** Another budget, mid-session; returns the pages evicted at once. */
    resize(budgetBytes: number) {
      pool = poolFor(budgetBytes);
      return trim();
    },
  };
}

/**
 * The pool wired into the backend: page arrivals and departures go through it, the host sets its
 * budget mid-session and reads it in the frame metrics.
 */
export function createAutonomousPool(env: {
  context: BackendContext;
  descriptors: ReadonlyMap<string, GeometryPageDescriptor>;
  bootstrapUrls: ReadonlySet<string>;
  allPages: readonly PageRec[];
  gate: WebglFrameGate;
  geometryStore: ReturnType<typeof createAutonomousGeometry>;
  residency: ReturnType<typeof createAutonomousResidency>;
}) {
  const { context, allPages, gate, geometryStore, residency } = env;
  const { state } = geometryStore;
  const budget = createGeometryBudget({
    budgetBytes: context.geometryPoolBytes,
    descriptors: env.descriptors,
    rootPages: env.bootstrapUrls.size,
    state,
    kept: residency.pageUrls,
    drop: residency.dropPage,
  });
  return {
    budget,
    /** Read with the frame metrics: the budget, and what the pages hold under it — no pool is
     *  reserved on this path. Accessors, so a spread copies the values without allocating. */
    metrics: {
      get geometryPoolBytes() {
        return budget.held.budgetBytes;
      },
      get geometryPoolSlots() {
        return budget.held.slots;
      },
      get geometryPoolAllocatedBytes() {
        return state.allocationBytes;
      },
      get geometryPoolClamp() {
        return budget.held.clamp;
      },
    },
    api: {
      dropPage(url: string) {
        gate.resourcesChanged();
        residency.dropPage(url);
        budget.left(url);
      },
      acceptGeometryPage(url: string, data: DecodedGeometryPage) {
        gate.resourcesChanged();
        geometryStore.acceptGeometryPage(url, data);
        budget.arrived(url);
      },
      /** The geometry pool only: the texture pools are the WebGPU engine's, this path samples the
       *  host's textures whole (`texturePool: null`). */
      async setMemoryBudgets(budgets: MemoryBudgets): Promise<MemoryBudgetsReport> {
        const started = performance.now(),
          before = comptePagesResidentes(allPages);
        const evictedPages =
          budgets.geometryPoolBytes === undefined ? 0 : budget.resize(budgets.geometryPoolBytes);
        gate.resourcesChanged();
        const report = {
          geometryPool: budget.report(),
          texturePool: null,
          evictedPages,
          evictedTiles: 0,
          residentPages: { before, after: comptePagesResidentes(allPages) },
          residentTiles: { before: 0, after: 0 },
          durationMs: performance.now() - started,
        };
        context.onDiagnostic?.({
          phase: 'memory-budgets',
          message: 'Memory pools set',
          context: report,
        });
        return report;
      },
    },
  };
}
