import {
  checkTexturePoolBudget,
  type GeometryPool,
  type MemoryBudgets,
  type MemoryBudgetsReport,
} from '../../../residency/pools.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import { grantedGeometryPool, grantedTexturePool, sameLayers } from '../../residency/poolGrants.ts';
import type { TexturePool } from '../../residency/memoryBudgets.ts';

/**
 * Changes memory pools mid-session, like the reference's variables — but without emptying what they
 * hold: pages and tiles that fit in the new pool are copied there on the GPU, only those that no
 * longer fit leave, and the image stays complete throughout the setting. A value that cannot be held
 * is brought back to what can, and the report says why (`clamp`); the geometry pool never exceeds the
 * session ceiling (`geometryPoolCeilingBytes`), which the drawable-page tables have set. A pool the
 * device refuses is drawn smaller, and one it refuses even at its floor keeps what it holds
 * (`poolGrants.ts`): out of memory is absorbed here, never handed to the frame.
 */
export async function setWebgpuMemoryBudgets(
  rt: WebgpuPagesRuntime,
  budgets: MemoryBudgets,
): Promise<MemoryBudgetsReport> {
  const { setup, gpu, vis, run, diag } = rt;
  const started = performance.now();
  const diagnose = diag.engineDiagnostic;
  let evictedPages = 0,
    evictedTiles = 0;
  const residentTiles = () =>
    vis.textures
      ? [...vis.textures.color.pools, ...vis.textures.data.pools].reduce(
          (total, pool) => total + pool.resident,
          0,
        )
      : 0;
  const residentPages = () => gpu.cache?.stats().residentPages ?? 0;
  const before = { pages: residentPages(), tiles: residentTiles() };
  // A pool is replaced only by one the device grants; none granted, even at its floor, and the pool
  // in place stays.
  const device = gpu.device;
  const live = () => !!device && !run.lost;
  // Tiles first: their copy is synchronous, the pages' waits for in-flight loads.
  if (budgets.texturePoolBytes !== undefined) {
    checkTexturePoolBudget(budgets.texturePoolBytes);
    setup.texturePoolBudget = budgets.texturePoolBytes;
    const pools = setup.texturePools;
    if (pools) {
      const bytes = budgets.texturePoolBytes;
      let pool: TexturePool | undefined = pools.poolFor(bytes);
      if (!sameLayers(pool, pools.pool) && vis.textures && live())
        pool = await grantedTexturePool(device!, bytes, pools, diagnose);
      if (pool) {
        if (vis.textures && !run.lost) evictedTiles = vis.textures.resize(pool.layers);
        pools.pool = pool;
      }
    }
  }
  if (budgets.geometryPoolBytes !== undefined) {
    const bytes = budgets.geometryPoolBytes;
    let pool: GeometryPool | undefined = setup.geometryPoolFor(bytes);
    if (pool.slots !== setup.slots && gpu.cache && live())
      pool = await grantedGeometryPool(device!, bytes, setup.geometryPoolFor, diagnose);
    if (pool && pool.slots !== setup.slots && gpu.cache && !run.lost) {
      // The root cover keeps its place before any other page: the pool never goes below it, and a
      // cut can only be completed from it.
      const evicted = await gpu.cache.resize(pool.slots, setup.bootstrapUrls);
      // A pinned page that has just been evicted: the pin trace knows, and the pin step puts it back
      // in the queue if the image still keeps it — the path of a host page drop.
      for (const url of evicted) {
        const key = setup.tracking.pageCatalogIds.get(url);
        if (key !== undefined) setup.tracking.unmarkPinned(key);
      }
      evictedPages = evicted.length;
    }
    if (pool) setup.geometryPool = pool;
  }
  // Origin of the resource change: what the image holds has changed place or size.
  run.gate.resourcesChanged();
  const report = {
    geometryPool: setup.geometryPool,
    texturePool: setup.texturePools?.pool ?? null,
    evictedPages,
    evictedTiles,
    residentPages: { before: before.pages, after: residentPages() },
    residentTiles: { before: before.tiles, after: residentTiles() },
    durationMs: performance.now() - started,
  };
  diag.engineDiagnostic('memory-budgets', 'Memory pools set', report);
  return report;
}
