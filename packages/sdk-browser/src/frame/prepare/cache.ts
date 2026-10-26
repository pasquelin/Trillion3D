import { createGpuPageCache } from '../../geometry/pages/pool/pages.ts'
import { grantedGeometryPool } from '../../geometry/residency/poolGrants.ts'
import { grantedLatest } from './grantLatest.ts'
import { stopped, throwIfStopped } from '../io/lost.ts'
import { type WebgpuPagesRuntime } from '../backend/runtime.ts'
import type { GeometryPool } from '../../session/memory/pools.ts'

/**
 * The engine's GPU page cache, with its trace hook. Cache events are sampled only if trace is
 * requested: otherwise no closure is posted, and the cache does not even have an observer to call.
 */
function createWebgpuPagesCache(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice, pool: GeometryPool) {
  const { diag, run, services } = rt,
    { pageBytes, homes, coverUrls: cover, rootUrls, census } = rt.setup,
    { slots, roots } = pool
  // Each address's streaming page, read on the census, which a source added later joins in place.
  const units = (address: string) => census.units.get(address)
  const options = (
    diag.traceEnabled
      ? {
          ...{ pageBytes, slots, roots, rootUrls, homes, units, cover },
          onDiagnostic: (event: {
            phase: string
            message: string
            context: Record<string, unknown>
          }) =>
            diag.traceDiagnostic(`cache-${event.phase}`, event.message, () => ({
              ...event.context,
              frame: run.frame,
            })),
        }
      : { pageBytes, slots, roots, rootUrls, homes, units, cover }
  ) as Parameters<typeof createGpuPageCache>[2]
  return createGpuPageCache(gpuDevice, services.pageSource, options)
}

/**
 * Out of memory absorbed: the geometry pool is the one the device grants, its cache allocated
 * once, under the out-of-memory scope (`poolGrants.ts`), its streaming slots the whole of its
 * budget (`../../session/memory/pools.ts`). Refused even at its floor, the root cover: refused by
 * name, never allocated at the full request outside any scope. Until a pool is granted,
 * `setMemoryBudgets` records its budget on `setup.geometryPool`, and the later word is granted in
 * turn (`grantedLatest`).
 */
export async function grantWebgpuPagesCache(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice) {
  const { setup, gpu, diag } = rt
  const held = await grantedLatest({
    budget: () => setup.geometryPool.budgetBytes,
    draw: (bytes) => ({ bytes, pool: setup.geometryPoolFor(bytes) }),
    same: (drawn, pool) => drawn.slots === pool.slots,
    grant: ({ bytes }) =>
      grantedGeometryPool(
        gpuDevice,
        bytes,
        setup.geometryPoolFor,
        diag.engineDiagnostic,
        (pool) => {
          const cache = createWebgpuPagesCache(rt, gpuDevice, pool)
          return { cache, destroy: () => void cache.dispose() }
        },
      ),
    stopped: () => stopped(rt),
  })
  if (!held) throw new Error('WEBGPU_GEOMETRY_POOL_REFUSED')
  setup.geometryPool = held.pool
  gpu.cache = held.made.cache
  // The pages of a geometry pool are installed by two compute passes: a device that refuses one
  // refuses the scene, since no page would ever land.
  try {
    await gpu.cache.prepare()
  } catch {
    throw new Error('WEBGPU_PAGE_INSTALL_UNAVAILABLE')
  }
  throwIfStopped(rt)
}
