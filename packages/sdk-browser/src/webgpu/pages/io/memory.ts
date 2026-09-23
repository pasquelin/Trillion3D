import {
  checkTexturePoolBudget,
  type GeometryPool,
  type TexturePool,
} from '../../residency/memoryBudgets.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/** What a host can change mid-session; a missing field keeps its value. */
export type MemoryBudgets = {
  /** Bytes for geometry pages. */
  geometryPoolBytes?: number;
  /** Bytes for texture tiles. */
  texturePoolBytes?: number;
};

/** Pools as the engine holds them after the setting, and what the setting cost. */
export type MemoryBudgetsReport = {
  /** The geometry pool after the change. */
  geometryPool: GeometryPool;
  /** `null` before prepare has drawn the lane pools: the budget is kept for it. */
  texturePool: TexturePool | null;
  /** Pages and tiles the new pool could not keep: they will come back if the image asks again, their
   *  coarse level holding the place in the meantime. */
  evictedPages: number;
  /** Texture tiles removed. */
  evictedTiles: number;
  /** What resided just before the setting and just after. */
  residentPages: { before: number; after: number };
  /** Texture tiles held, before and after. */
  residentTiles: { before: number; after: number };
  /** Time it took. */
  durationMs: number;
};

/**
 * Changes memory pools mid-session, like the reference's variables — but without emptying what they
 * hold: pages and tiles that fit in the new pool are copied there on the GPU, only those that no
 * longer fit leave, and the image stays complete throughout the setting. A value that cannot be held
 * is brought back to what can, and the report says why (`clamp`); the geometry pool never exceeds the
 * session ceiling (`geometryPoolCeilingBytes`), which the drawable-page tables have set.
 */
export async function setWebgpuMemoryBudgets(
  rt: WebgpuPagesRuntime,
  budgets: MemoryBudgets,
): Promise<MemoryBudgetsReport> {
  const { setup, gpu, vis, run, diag } = rt;
  const started = performance.now();
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
  // Tiles first: their copy is synchronous, the pages' waits for in-flight loads.
  if (budgets.texturePoolBytes !== undefined) {
    checkTexturePoolBudget(budgets.texturePoolBytes);
    setup.texturePoolBudget = budgets.texturePoolBytes;
    if (setup.texturePools) {
      const pool = setup.texturePools.poolFor(budgets.texturePoolBytes);
      if (vis.textures && !run.lost) evictedTiles = vis.textures.resize(pool.layers);
      setup.texturePools.pool = pool;
    }
  }
  if (budgets.geometryPoolBytes !== undefined) {
    const pool = setup.geometryPoolFor(budgets.geometryPoolBytes);
    if (pool.slots !== setup.slots && gpu.cache && !run.lost) {
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
    setup.geometryPool = pool;
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
