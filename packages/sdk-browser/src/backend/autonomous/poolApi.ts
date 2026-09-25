import type { GeometryPageDescriptor } from '../../../../sdk-core/src/index.ts';
import type { MemoryBudgets, MemoryBudgetsReport } from '../../residency/pools.ts';
import type { BackendContext } from '../types.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import type { DecodedGeometryPage } from '../../page/decode/geometryPage.ts';
import type { WebglFrameGate } from '../../webgl/core/frameGate.ts';
import type { createAutonomousGeometry } from './geometry.ts';
import type { createAutonomousResidency } from './residency.ts';
import { createGeometryBudget, type PageCopies } from './pool.ts';
import type { HeldFloor } from './heldFloor.ts';
import { checkTexturePoolBudget } from '../../residency/pools.ts';
import { sendEngineDiagnostic } from '../../diagnostic/engineDiagnostic.ts';

/**
 * The copies each page holds once resident (`PageCopies`), from the records collected when the
 * backend opens: those that own their geometry, and whether rows share one more. Every classic
 * instance clones each record that owns its geometry and shares the rows' one (`instances.ts`):
 * the counts follow the instance count, and nothing is walked again after this.
 */
export function pageCopies(
  byUrl: ReadonlyMap<string, readonly PageRec[]>,
  rootUrls: ReadonlySet<string>,
  instanceCount: () => number,
): PageCopies {
  const owned = new Map<string, number>(),
    shared = new Set<string>();
  let sceneOwned = 0,
    rootOwned = 0,
    rootShared = 0;
  for (const [url, recs] of byUrl) {
    let own = 0;
    for (const rec of recs)
      if (rec.placement) shared.add(url);
      else own++;
    owned.set(url, own);
    sceneOwned += own;
    if (rootUrls.has(url)) {
      rootOwned += own;
      if (shared.has(url)) rootShared++;
    }
  }
  const each = () => 1 + instanceCount();
  return {
    of: (url) => (owned.get(url) ?? 0) * each() + (shared.has(url) ? 1 : 0),
    root: () => rootOwned * each() + rootShared,
    scene: () => sceneOwned * each() + shared.size,
  };
}

/**
 * The geometry pool wired into the WebGL2 backend (`pool.ts`): each page asked for charges its
 * share of the budget, page arrivals and departures go through the pool, the host sets its budget
 * mid-session and reads it in the frame metrics.
 */
export function createAutonomousPool(env: {
  context: BackendContext;
  descriptors: ReadonlyMap<string, GeometryPageDescriptor>;
  bootstrapUrls: ReadonlySet<string>;
  modifiedPages: Set<string>;
  byUrl: ReadonlyMap<string, readonly PageRec[]>;
  cap: number;
  gate: WebglFrameGate;
  geometryStore: ReturnType<typeof createAutonomousGeometry>;
  residency: ReturnType<typeof createAutonomousResidency>;
  heldFloor: HeldFloor;
  instanceCount: () => number;
}) {
  const { context, byUrl, gate, geometryStore, residency, heldFloor } = env,
    { state } = geometryStore;
  const budget = createGeometryBudget({
    budgetBytes: context.geometryPoolBytes,
    ceilingBytes: context.geometryPoolCeilingBytes,
    maxResidentPages: env.cap,
    descriptors: env.descriptors,
    rootUrls: env.bootstrapUrls,
    copies: pageCopies(byUrl, env.bootstrapUrls, env.instanceCount),
    coverRevision: () => heldFloor.revision,
    state,
    floorBytes: heldFloor.bytes,
    kept: residency.keptUrls,
    drop: residency.dropPage,
    onDiagnostic: context.onDiagnostic,
  });
  return {
    budget,
    /** Read with the frame metrics: the budget, and what the pages hold under it — no pool is
     *  reserved on this path. Accessors, so a spread copies the values without allocating. */
    metrics: {
      get residentPages() {
        return state.residentPages;
      },
      get geometryAllocationBytes() {
        return state.allocationBytes;
      },
      /** No pool is reserved on this path: the pages hold `geometryAllocationBytes`. */
      geometryPoolAllocatedBytes: null,
      get geometryPoolBytes() {
        return budget.held.budgetBytes;
      },
      get geometryPoolSlots() {
        return budget.held.slots;
      },
      get geometryPoolClamp() {
        return budget.clamp;
      },
      /** No texture pool on this path: `world.budget.texturePool` reads `null`. */
      texturePoolBytes: null,
    },
    api: {
      /** Publishes the pool's verdict, as on WebGPU. */
      async flush() {
        budget.flush();
      },
      dropPage(url: string) {
        gate.resourcesChanged();
        residency.dropPage(url);
        budget.left(url);
      },
      acceptGeometryPage(url: string, data: DecodedGeometryPage) {
        gate.resourcesChanged();
        if (geometryStore.acceptGeometryPage(url, data)) budget.arrived(url);
      },
      /** A replaced page is the host's for good: it leaves the order and joins the floor. */
      replaceGeometryPage(url: string, data: DecodedGeometryPage) {
        if (!byUrl.has(url)) throw new Error('AUTONOMOUS_PAGE_MISSING');
        gate.resourcesChanged();
        if (!geometryStore.storeGeometryPage(url, data)) return;
        env.modifiedPages.add(url);
        heldFloor.changed();
        budget.left(url);
      },
      /** The geometry pool only: the texture pools are the WebGPU engine's, this path samples the
       *  host's textures whole (`texturePool: null`). Both budgets are checked before either
       *  changes, as on WebGPU. */
      async setMemoryBudgets(budgets: MemoryBudgets): Promise<MemoryBudgetsReport> {
        if (budgets.texturePoolBytes !== undefined)
          checkTexturePoolBudget(budgets.texturePoolBytes);
        const started = performance.now(),
          before = state.residentPages;
        const evictedPages =
          budgets.geometryPoolBytes === undefined ? 0 : budget.resize(budgets.geometryPoolBytes);
        gate.resourcesChanged();
        const report = {
          geometryPool: { ...budget.held, allocatedBytes: state.allocationBytes },
          texturePool: null,
          evictedPages,
          evictedTiles: 0,
          residentPages: { before, after: state.residentPages },
          residentTiles: { before: 0, after: 0 },
          durationMs: performance.now() - started,
        };
        sendEngineDiagnostic(context.onDiagnostic, 'memory-budgets', 'Memory pools set', report);
        return report;
      },
    },
  };
}
