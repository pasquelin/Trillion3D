import { createGpuPageCache } from '../../../gpu/page/pages.ts';
import { grantedGeometryPool } from '../../residency/poolGrants.ts';
import { vertexBytesOf } from '../io/metrics.ts';
import { throwIfStopped } from '../io/lost.ts';
import { type WebgpuPagesRuntime } from '../runtime.ts';

/**
 * The engine's GPU page cache, with its trace hook. Cache events are sampled only if trace is
 * requested: otherwise no closure is posted, and the cache does not even have an observer to call.
 */
export function createWebgpuPagesCache(
  rt: WebgpuPagesRuntime,
  gpuDevice: GPUDevice,
  slots: number,
) {
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
 * The geometry pool the session's rule draws for a budget, less the vertex buffers the session
 * holds outside its slots (`vertexBytesOf`): `geometryAllocationBytes` counts both, so both are
 * paid from the one budget and never sum past it.
 */
export const geometryPoolDrawer = (rt: WebgpuPagesRuntime) => (budgetBytes: number) =>
  rt.setup.geometryPoolFor(budgetBytes, vertexBytesOf(rt.gpu, rt.vis));

/**
 * Out of memory absorbed: the geometry pool is the one the device grants, its cache allocated
 * once, under the out-of-memory scope (`poolGrants.ts`), after the vertex buffers it is drawn
 * beside. Refused even at its floor, the root cover: refused by name, never allocated at the full
 * request outside any scope.
 */
export async function grantWebgpuPagesCache(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice) {
  const { setup, gpu, diag } = rt;
  const granted = await grantedGeometryPool(
    gpuDevice,
    setup.geometryPool.budgetBytes,
    geometryPoolDrawer(rt),
    diag.engineDiagnostic,
    (pool) => {
      const cache = createWebgpuPagesCache(rt, gpuDevice, pool.slots);
      return { cache, destroy: () => void cache.dispose() };
    },
  );
  if (!granted) throw new Error('WEBGPU_GEOMETRY_POOL_REFUSED');
  setup.geometryPool = granted.pool;
  gpu.cache = granted.made.cache;
  throwIfStopped(rt);
}
