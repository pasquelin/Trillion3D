import {
  checkGeometryPoolBudget,
  checkTexturePoolBudget,
  type GeometryPool,
  type MemoryBudgets,
  type MemoryBudgetsReport,
} from '../../../residency/pools.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import {
  budgetBeside,
  geometryProbe,
  grantedGeometryPool,
  grantedTexturePool,
  probed,
  sameLayers,
  textureProbe,
} from '../../residency/poolGrants.ts';
import type { TexturePool } from '../../residency/memoryBudgets.ts';
import { vertexBytesOf } from './metrics.ts';
import { growWebgpuTables } from '../prepare/growTables.ts';

/**
 * A geometry budget less the vertex buffers held beside its slots (`vertexBytesOf`, #487):
 * `geometryAllocationBytes` counts both, so the slots are drawn and granted from `bytes` and the
 * two never sum past the budget; `declared` records on the pool drawn the budget the host set.
 */
export function geometryBudgetBeside(rt: WebgpuPagesRuntime, budgetBytes: number) {
  checkGeometryPoolBudget(budgetBytes);
  const { bytes, deducted } = budgetBeside(budgetBytes, vertexBytesOf(rt.gpu, rt.vis));
  return {
    bytes,
    declared: (pool: GeometryPool) => ({ ...pool, budgetBytes: pool.budgetBytes + deducted }),
  };
}

/** Texture bytes held beside the texture pool, outside it, within the one texture budget: the live
 *  textures' working textures (#362) and the resident impostor atlases (#1335). */
export const textureBytesBeside = (rt: Pick<WebgpuPagesRuntime, 'vis' | 'gpu'>) =>
  (rt.vis.textures?.sources.liveBytes ?? 0) + (rt.gpu.impostors?.pass.feed.bytes ?? 0);

/** Host bytes the session holds for the streamer's reservation: the cut's tables and residency,
 *  plus the bounce and far-sun proxies (the far sun's, when borrowed from bounce, once). */
export function hostTableBytesOf(rt: WebgpuPagesRuntime) {
  const { services, bounce, sunFar } = rt;
  const sunBytes = sunFar.borrowed ? 0 : (sunFar.gpu?.proxy?.hostBytes ?? 0);
  return services.hostTableBytes() + (bounce.probes?.proxy.hostBytes ?? 0) + sunBytes;
}

/**
 * Changes memory pools mid-session, like the reference's variables — but without emptying what they
 * hold: pages and tiles that fit in the new pool are copied there on the GPU, only those that no
 * longer fit leave, and the image stays complete throughout the setting. A value that cannot be held
 * is brought back to what can, and the report says why (`clamp`). A geometry pool above the
 * drawable-page tables — past the ceiling the host named (`geometryPoolCeilingBytes`) — grows
 * them in place first (`growTables.ts`, `tables` in the report); tables the device refuses keep
 * the pool in place. A pool the device refuses is drawn smaller, and one it refuses even at its
 * floor keeps what it holds (`poolGrants.ts`): out of memory is absorbed here, never handed to the
 * frame. The new pool is probed while the old one lives, and the copy holds both at once
 * (`transientBytes`): that peak is what the device granted, before any page moves.
 */
export async function setWebgpuMemoryBudgets(
  rt: WebgpuPagesRuntime,
  budgets: MemoryBudgets,
  origin: 'host' | 'prepare-targets' = 'host',
): Promise<MemoryBudgetsReport> {
  const { setup, gpu, vis, run, diag } = rt;
  const started = performance.now();
  const diagnose = diag.engineDiagnostic;
  let evictedPages = 0,
    evictedTiles = 0,
    transientBytes = 0,
    tables: MemoryBudgetsReport['tables'] = null;
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
  // Tiles first: their copy is synchronous, the pages' waits for in-flight loads.
  if (budgets.texturePoolBytes !== undefined) {
    checkTexturePoolBudget(budgets.texturePoolBytes);
    const pools = setup.texturePools;
    // Before prepare nothing is granted yet: the budget is kept, and prepare draws it.
    if (!pools) setup.texturePoolBudget = budgets.texturePoolBytes;
    else {
      // A live texture's working texture (#362) and an impostor atlas (#1335) are texture memory
      // too: the pool is drawn from what the budget leaves it, the budget recorded staying the one
      // declared.
      const live = textureBytesBeside(rt),
        { bytes, deducted } = budgetBeside(budgets.texturePoolBytes, live);
      pools.liveBytes = live;
      let pool: TexturePool | undefined = pools.poolFor(bytes);
      if (!sameLayers(pool, pools.pool) && vis.textures && device && !run.lost)
        pool = await probed(
          grantedTexturePool(device, bytes, pools, diagnose, textureProbe(device, pools.encoding)),
        );
      if (pool) {
        if (vis.textures && !run.lost) evictedTiles = vis.textures.resize(pool.layers);
        pools.pool = pool;
        // What the device granted, not what was asked: a refusal keeps the budget in place.
        setup.texturePoolBudget = pool.budgetBytes + deducted;
      }
    }
  }
  if (budgets.geometryPoolBytes !== undefined) {
    const { bytes, declared } = geometryBudgetBeside(rt, budgets.geometryPoolBytes);
    // A pool above the tables waits for a running prepare: the tables it builds are those that grow.
    if (setup.preparing && setup.geometryPoolFor(bytes).slots > setup.cap) {
      if (origin === 'prepare-targets') throw new Error('TARGET_ADMISSION_REQUIRES_TABLE_GROWTH');
      await setup.preparing;
    }
    let pool: GeometryPool | undefined = setup.geometryPoolFor(bytes);
    // The tables first: a pool whose pages would find no row is never put in place, and the probe
    // then asks the device for the pool beside the tables it already holds.
    if (pool.slots > setup.cap) {
      tables = await growWebgpuTables(rt, pool.slots);
      if (tables?.refused) pool = undefined;
    }
    if (pool && pool.slots !== setup.slots && gpu.cache && device && !run.lost)
      pool = await probed(
        grantedGeometryPool(device, bytes, setup.geometryPoolFor, diagnose, geometryProbe(device)),
      );
    if (pool && pool.slots !== setup.slots && gpu.cache && !run.lost) {
      transientBytes = setup.geometryPool.allocatedBytes + pool.allocatedBytes;
      // The root cover keeps its place before any other page: the pool never goes below it, and a
      // cut can only be completed from it.
      const evicted = await gpu.cache.resize(pool.slots);
      // A pinned page that has just been evicted: the pin trace knows, and the pin step puts it back
      // in the queue if the image still keeps it — the path of a host page drop.
      for (const url of evicted) {
        const key = setup.tracking.pageCatalogIds.get(url);
        if (key !== undefined) setup.tracking.unmarkPinned(key);
      }
      evictedPages = evicted.length;
    }
    if (pool) setup.geometryPool = declared(pool);
  }
  // Origin of the resource change: what the image holds has changed place or size.
  run.gate.resourcesChanged();
  // Set while prepare runs, a budget is only recorded: the report waits for prepare, and names the
  // pools the device grants. A prepare that fails reports its own failure.
  if (origin === 'host') await setup.preparing;
  const report = {
    geometryPool: setup.geometryPool,
    texturePool: setup.texturePools?.pool ?? null,
    evictedPages,
    evictedTiles,
    residentPages: { before: before.pages, after: residentPages() },
    residentTiles: { before: before.tiles, after: residentTiles() },
    durationMs: performance.now() - started,
    tables,
    transientBytes,
  };
  diag.engineDiagnostic('memory-budgets', 'Memory pools set', report);
  return report;
}

/**
 * A texture turned live (#362) or an impostor atlas landed or left (#1335) since the pool was
 * drawn: the pool is drawn again under the same budget, less the bytes held beside it, as
 * `setMemoryBudgets` draws it — tiles kept, out of memory absorbed. Once per change; a still scene
 * reads one number.
 */
export function followLiveTextures(rt: WebgpuPagesRuntime) {
  const pools = rt.setup.texturePools,
    live = textureBytesBeside(rt);
  if (!pools || live === (pools.liveBytes ?? 0)) return;
  setWebgpuMemoryBudgets(rt, { texturePoolBytes: rt.setup.texturePoolBudget }).catch((error) =>
    rt.diag.diagnosticFailure('texture-live-budget', error),
  );
}
