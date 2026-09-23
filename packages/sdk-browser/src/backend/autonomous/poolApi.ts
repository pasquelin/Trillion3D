import type { GeometryPageDescriptor } from '../../../../sdk-core/src/index.ts';
import type { MemoryBudgets, MemoryBudgetsReport } from '../../webgpu/pages/io/memory.ts';
import type { BackendContext } from '../types.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import type { DecodedGeometryPage } from '../../page/decode/geometryPage.ts';
import type { WebglFrameGate } from '../../webgl/core/frameGate.ts';
import type { PlacementRows } from '../../placement/rows.ts';
import type { createAutonomousGeometry } from './geometry.ts';
import { comptePagesResidentes, type createAutonomousResidency } from './residency.ts';
import { createGeometryBudget } from './pool.ts';
import { checkTexturePoolBudget } from '../../webgpu/residency/memoryBudgets.ts';
import { sendEngineDiagnostic } from '../../webgpu/pages/io/diagnostics.ts';
import { hostPageBytes } from '../../host/pageObjects.ts';

/** Decoded bytes `recs` hold, a geometry shared by several records counted once. */
function heldBytes(recs: readonly PageRec[]) {
  const seen = new Set<object>();
  let bytes = 0;
  for (const rec of recs)
    if (rec.geometry && !seen.has(rec.geometry)) {
      seen.add(rec.geometry);
      bytes += hostPageBytes(rec.geometry);
    }
  return bytes;
}

/**
 * The geometry pool wired into the WebGL2 backend (`pool.ts`): page arrivals and departures go
 * through it, what changes the root cover tells it, the host sets its budget mid-session and reads
 * it in the frame metrics.
 */
export function createAutonomousPool(env: {
  context: BackendContext;
  descriptors: ReadonlyMap<string, GeometryPageDescriptor>;
  bootstrap: readonly PageRec[];
  bootstrapUrls: ReadonlySet<string>;
  modifiedPages: Set<string>;
  allPages: readonly PageRec[];
  byUrl: ReadonlyMap<string, readonly PageRec[]>;
  cap: number;
  gate: WebglFrameGate;
  geometryStore: ReturnType<typeof createAutonomousGeometry>;
  residency: ReturnType<typeof createAutonomousResidency>;
  instances: {
    addInstance(id: string, transform: Float64Array): void;
    removeInstance(id: string): void;
  };
  placements: { growPlacements(from: PlacementRows, to: PlacementRows): void };
}) {
  const { context, bootstrap, allPages, byUrl, gate, geometryStore, residency } = env;
  const { instances, placements } = env,
    { state } = geometryStore;
  const budget = createGeometryBudget({
    budgetBytes: context.geometryPoolBytes,
    ceilingBytes: context.geometryPoolCeilingBytes,
    maxResidentPages: env.cap,
    descriptors: env.descriptors,
    rootUrls: env.bootstrapUrls,
    state,
    rootBytes: () => heldBytes(bootstrap),
    kept: residency.pageUrls,
    drop: residency.dropPage,
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
      // What changes the root cover changes the floor the pool never goes below.
      replaceGeometryPage(url: string, data: DecodedGeometryPage) {
        if (!byUrl.has(url)) throw new Error('AUTONOMOUS_PAGE_MISSING');
        gate.resourcesChanged();
        geometryStore.storeGeometryPage(url, data);
        env.modifiedPages.add(url);
        budget.rootsChanged();
      },
      addInstance(id: string, transform: Float64Array) {
        instances.addInstance(id, transform);
        budget.rootsChanged();
      },
      removeInstance(id: string) {
        instances.removeInstance(id);
        budget.rootsChanged();
      },
      growPlacements(from: PlacementRows, to: PlacementRows) {
        placements.growPlacements(from, to);
        budget.rootsChanged();
      },
      /** The geometry pool only: the texture pools are the WebGPU engine's, this path samples the
       *  host's textures whole (`texturePool: null`). Both budgets are checked before either
       *  changes, as on WebGPU. */
      async setMemoryBudgets(budgets: MemoryBudgets): Promise<MemoryBudgetsReport> {
        if (budgets.texturePoolBytes !== undefined)
          checkTexturePoolBudget(budgets.texturePoolBytes);
        const started = performance.now(),
          before = comptePagesResidentes(allPages);
        const evictedPages =
          budgets.geometryPoolBytes === undefined ? 0 : budget.resize(budgets.geometryPoolBytes);
        gate.resourcesChanged();
        const report = {
          geometryPool: { ...budget.held, allocatedBytes: state.allocationBytes },
          texturePool: null,
          evictedPages,
          evictedTiles: 0,
          residentPages: { before, after: comptePagesResidentes(allPages) },
          residentTiles: { before: 0, after: 0 },
          durationMs: performance.now() - started,
        };
        sendEngineDiagnostic(context.onDiagnostic, 'memory-budgets', 'Memory pools set', report);
        return report;
      },
    },
  };
}
