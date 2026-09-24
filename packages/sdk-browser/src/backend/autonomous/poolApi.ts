import type { GeometryPageDescriptor } from '../../../../sdk-core/src/index.ts';
import type { MemoryBudgets, MemoryBudgetsReport } from '../../webgpu/pages/io/memory.ts';
import type { BackendContext } from '../types.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import type { DecodedGeometryPage } from '../../page/decode/geometryPage.ts';
import type { WebglFrameGate } from '../../webgl/core/frameGate.ts';
import type { createAutonomousGeometry } from './geometry.ts';
import type { createAutonomousResidency } from './residency.ts';
import { createGeometryBudget, type PageCopies } from './pool.ts';
import { checkTexturePoolBudget } from '../../residency/pools.ts';
import { sendEngineDiagnostic } from '../../diagnostic/engineDiagnostic.ts';
import { hostPageBytes } from '../../host/pageObjects.ts';

/**
 * The copies each page holds once resident (`PageCopies`), from the records collected when the
 * backend opens: those that own their geometry, and whether rows share one more. Every classic
 * instance clones each of those records, rows only add records that share: the counts follow the
 * instance count, and nothing is walked again after this.
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
    rootShared = 0,
    mostOwned = 0;
  for (const [url, recs] of byUrl) {
    let own = 0;
    for (const rec of recs)
      if (rec.placement) shared.add(url);
      else own++;
    owned.set(url, own);
    sceneOwned += own;
    mostOwned = Math.max(mostOwned, own);
    if (rootUrls.has(url)) {
      rootOwned += own;
      if (shared.has(url)) rootShared++;
    }
  }
  const each = () => 1 + instanceCount();
  return {
    get generation() {
      return instanceCount();
    },
    of: (url) => (owned.get(url) ?? 0) * each() + (shared.has(url) ? 1 : 0),
    root: () => rootOwned * each() + rootShared,
    scene: () => sceneOwned * each() + shared.size,
    most: () => mostOwned * each() + 1,
  };
}

/**
 * Decoded bytes nothing may evict: the root cover and the pages the host replaced, a geometry
 * several records share counted once. Read again only when the scene revision moves — an
 * instance, a row growth, the root cover loaded — or the host replaces another page.
 */
export function heldFloorBytes(env: {
  gate: Pick<WebglFrameGate, 'revisions'>;
  bootstrap: readonly PageRec[];
  modifiedPages: ReadonlySet<string>;
  byUrl: ReadonlyMap<string, readonly PageRec[]>;
}) {
  const { gate, bootstrap, modifiedPages, byUrl } = env;
  const seen = new Set<ArrayBufferView>();
  let scene = -1,
    modified = -1,
    bytes = 0;
  const add = (rec: PageRec) => {
    if (rec.geometry) bytes += hostPageBytes(rec.geometry, seen);
  };
  return () => {
    if (scene === gate.revisions.scene && modified === modifiedPages.size) return bytes;
    scene = gate.revisions.scene;
    modified = modifiedPages.size;
    seen.clear();
    bytes = 0;
    for (const rec of bootstrap) add(rec);
    for (const url of modifiedPages) for (const rec of byUrl.get(url) ?? []) add(rec);
    return bytes;
  };
}

/** Distinct pages whose geometry is resident: counted by page, as the pool evicts them. */
export function residentPages(byUrl: ReadonlyMap<string, readonly PageRec[]>) {
  let pages = 0;
  for (const recs of byUrl.values()) if (recs.some((rec) => rec.array)) pages++;
  return pages;
}

/**
 * The geometry pool wired into the WebGL2 backend (`pool.ts`): page arrivals and departures go
 * through it, the host sets its budget mid-session and reads it in the frame metrics.
 */
export function createAutonomousPool(env: {
  context: BackendContext;
  descriptors: ReadonlyMap<string, GeometryPageDescriptor>;
  bootstrap: readonly PageRec[];
  bootstrapUrls: ReadonlySet<string>;
  modifiedPages: Set<string>;
  byUrl: ReadonlyMap<string, readonly PageRec[]>;
  cap: number;
  gate: WebglFrameGate;
  geometryStore: ReturnType<typeof createAutonomousGeometry>;
  residency: ReturnType<typeof createAutonomousResidency>;
  instanceCount: () => number;
}) {
  const { context, byUrl, gate, geometryStore, residency } = env,
    { state } = geometryStore;
  const budget = createGeometryBudget({
    budgetBytes: context.geometryPoolBytes,
    ceilingBytes: context.geometryPoolCeilingBytes,
    maxResidentPages: env.cap,
    descriptors: env.descriptors,
    rootUrls: env.bootstrapUrls,
    copies: pageCopies(byUrl, env.bootstrapUrls, env.instanceCount),
    state,
    floorBytes: heldFloorBytes(env),
    kept: residency.pageUrls,
    drop: residency.dropPage,
    onDiagnostic: context.onDiagnostic,
  });
  return {
    budget,
    /** Read with the frame metrics: the budget, and what the pages hold under it — no pool is
     *  reserved on this path. Accessors, so a spread copies the values without allocating. */
    metrics: {
      get geometryAllocationBytes() {
        return state.allocationBytes;
      },
      get geometryPoolAllocatedBytes() {
        return state.allocationBytes;
      },
      get geometryPoolBytes() {
        return budget.held.budgetBytes;
      },
      get geometryPoolSlots() {
        return budget.held.slots;
      },
      get geometryPoolClamp() {
        return budget.held.clamp;
      },
      get budgetPixelError() {
        return budget.budgetPixelError;
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
        if (geometryStore.acceptGeometryPage(url, data)) budget.arrived(url);
      },
      /** A replaced page is the host's for good: it leaves the order and joins the floor. */
      replaceGeometryPage(url: string, data: DecodedGeometryPage) {
        if (!byUrl.has(url)) throw new Error('AUTONOMOUS_PAGE_MISSING');
        gate.resourcesChanged();
        geometryStore.storeGeometryPage(url, data);
        env.modifiedPages.add(url);
        budget.left(url);
      },
      /** The geometry pool only: the texture pools are the WebGPU engine's, this path samples the
       *  host's textures whole (`texturePool: null`). Both budgets are checked before either
       *  changes, as on WebGPU. */
      async setMemoryBudgets(budgets: MemoryBudgets): Promise<MemoryBudgetsReport> {
        if (budgets.texturePoolBytes !== undefined)
          checkTexturePoolBudget(budgets.texturePoolBytes);
        const started = performance.now(),
          before = residentPages(byUrl);
        const evictedPages =
          budgets.geometryPoolBytes === undefined ? 0 : budget.resize(budgets.geometryPoolBytes);
        gate.resourcesChanged();
        const report = {
          geometryPool: { ...budget.held, allocatedBytes: state.allocationBytes },
          texturePool: null,
          evictedPages,
          evictedTiles: 0,
          residentPages: { before, after: residentPages(byUrl) },
          residentTiles: { before: 0, after: 0 },
          durationMs: performance.now() - started,
        };
        sendEngineDiagnostic(context.onDiagnostic, 'memory-budgets', 'Memory pools set', report);
        return report;
      },
    },
  };
}
