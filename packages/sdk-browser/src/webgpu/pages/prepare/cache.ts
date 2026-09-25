import { createGpuPageCache } from '../../../gpu/page/pages.ts';
import { grantedGeometryPool } from '../../residency/poolGrants.ts';
import { geometryBudgetBeside, setWebgpuMemoryBudgets } from '../io/memory.ts';
import { throwIfStopped } from '../io/lost.ts';
import { type WebgpuPagesRuntime } from '../runtime.ts';

/**
 * The engine's GPU page cache, with its trace hook. Cache events are sampled only if trace is
 * requested: otherwise no closure is posted, and the cache does not even have an observer to call.
 */
function createWebgpuPagesCache(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice, slots: number) {
  const { diag, run, services } = rt,
    { pageBytes } = rt.setup;
  const options = (
    diag.traceEnabled
      ? {
          pageBytes,
          slots,
          onDiagnostic: (event: {
            phase: string;
            message: string;
            context: Record<string, unknown>;
          }) =>
            diag.traceDiagnostic(`cache-${event.phase}`, event.message, () => ({
              ...event.context,
              frame: run.frame,
            })),
        }
      : { pageBytes, slots }
  ) as Parameters<typeof createGpuPageCache>[2];
  return createGpuPageCache(gpuDevice, services.pageSource, options);
}

/**
 * Out of memory absorbed: the geometry pool is the one the device grants, its cache allocated
 * once, under the out-of-memory scope (`poolGrants.ts`), from what its budget leaves the vertex
 * buffers beside it (`geometryBudgetBeside`). Refused even at its floor, the root cover: refused
 * by name, never allocated at the full request outside any scope. A budget set while the device
 * answers (`setMemoryBudgets`) is the later word: the pool granted is then redrawn to it, as
 * mid-session.
 */
export async function grantWebgpuPagesCache(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice) {
  const { setup, gpu, diag } = rt,
    asked = setup.geometryPool,
    { bytes, declared } = geometryBudgetBeside(rt, asked.budgetBytes);
  const granted = await grantedGeometryPool(
    gpuDevice,
    bytes,
    setup.geometryPoolFor,
    diag.engineDiagnostic,
    (pool) => {
      const cache = createWebgpuPagesCache(rt, gpuDevice, pool.slots);
      return { cache, destroy: () => void cache.dispose() };
    },
  );
  if (!granted) throw new Error('WEBGPU_GEOMETRY_POOL_REFUSED');
  const later = setup.geometryPool !== asked ? setup.geometryPool.budgetBytes : undefined;
  setup.geometryPool = declared(granted.pool);
  gpu.cache = granted.made.cache;
  throwIfStopped(rt);
  if (later !== undefined) await setWebgpuMemoryBudgets(rt, { geometryPoolBytes: later });
}
