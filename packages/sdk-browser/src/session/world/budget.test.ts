import { MIB } from '../../../../math/src/constants.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { sessionPools, worldBudget, worldPools, type Pools } from './budget.ts'
import {
  DEFAULT_TEXTURE_POOL_BUDGET,
  DEFAULT_GEOMETRY_POOL_BUDGET,
} from '../../../../sdk-core/src/contracts/poolBudgets.ts'
import { DEFAULT_CACHED_BYTES } from '../../geometry/streaming/pageCache.ts'
import { DEFAULT_PHYSICS_BUDGET } from '../../../../sdk-core/src/physics/options.ts'
import { createBounceCascades } from '../../../../sdk-core/src/bounce/cascades.ts'
import type { FrameMetrics } from '../../../../sdk-core/src/contracts/metrics.ts'
import { tableBytes, tableExtent } from '../../lighting/bounce/atlas.ts'
import { vsmLayout } from '../../lighting/shadows/vsm/layout.ts'
import { poolSliceBytes } from '../../lighting/shadows/vsm/layoutBytes.ts'
import { SHADOW_POOL_BYTES, BOUNCE_PROBE_BYTES } from '../memory/shadowBudgetBytes.ts'
import { DEFAULT_GPU_BUDGET, EFFECT_TARGET_BYTES } from '../memory/budget.fixture.ts'

/** The virtual shadow maps of one sun at the default pool when this golden was taken, every part
 *  the shadow share sums (`shadowBudgetBytes.ts`): the set's buffers, the raster's two record lists
 *  at the records the reference's rule gives them (`vsmRecordCapacity`: 2²² · 1.5 records each, 134 217 728
 *  B more than 2²¹ records did). A change to any of them moves this number, and the share must be
 *  retaken with it. Retaken when the raster's chunks gave way to one cull and one raster a view pass:
 *  671 291 332 less the 2²¹ pairs, commands and order places (36 B each) plus the 2²¹ records and
 *  sorted records (32 B each), 8 MiB less. Retaken when the shadow maps took their occlusion culling:
 *  662 902 724 plus its depth pyramid (89 473 024 B: 8192 × 2048 r32float texels at level 0, seven
 *  levels), both frame sets' kept tables (33 554 432 B: a page table, its marks and the stale rects
 *  each), its page list and arguments, and the projection records' 96 more bytes over both frames. */
const ONE_SUN_SHADOW_MAP_BYTES = 921_749_336

const budget = (
  frame: Partial<FrameMetrics> | null,
  asked: Omit<Pools, 'pageCache'> = {},
  pools: Pools = Object.assign(worldPools(), asked),
) =>
  worldBudget(
    pools,
    { explorer: null },
    { last: frame as FrameMetrics | null },
    {
      ...DEFAULT_PHYSICS_BUDGET,
    },
  )

test('texturePool falls back to the asked budget while no pool was published', () => {
  assert.equal(budget({ texturePoolBytes: null }, { texturePool: 4096 }).texturePool, 4096)
  assert.equal(budget({ texturePoolBytes: null }).texturePool, DEFAULT_TEXTURE_POOL_BUDGET)
  assert.equal(budget(null).texturePool, DEFAULT_TEXTURE_POOL_BUDGET)
})

test('texturePool reads what the last frame held', () => {
  assert.equal(budget({ texturePoolBytes: 2048 }, { texturePool: 4096 }).texturePool, 2048)
})

test('the budget keeps no envelope for raycast trees: a ray is traced on the GPU, no tree kept', () => {
  assert.equal('raycastTrees' in budget(null), false)
})

test("the default totals split into each pool's own default", () => {
  const handle = budget(null)
  assert.equal(handle.gpu, DEFAULT_GPU_BUDGET)
  assert.equal(handle.cpu, DEFAULT_CACHED_BYTES)
  assert.deepEqual(handle.split, {
    shadowPool: SHADOW_POOL_BYTES,
    bounceProbes: BOUNCE_PROBE_BYTES,
    // No session holds a cut yet: its tables are funded as they are made.
    cutTables: 0,
    effectTargets: EFFECT_TARGET_BYTES,
    // Nothing live beside the pools without a session; the shares' one sum, funded first.
    frameTargets: 0,
    fixed: SHADOW_POOL_BYTES + BOUNCE_PROBE_BYTES + EFFECT_TARGET_BYTES,
    geometryPool: DEFAULT_GEOMETRY_POOL_BUDGET,
    texturePool: DEFAULT_TEXTURE_POOL_BUDGET,
    pageCache: DEFAULT_CACHED_BYTES,
  })
  assert.equal(handle.geometryPool, DEFAULT_GEOMETRY_POOL_BUDGET)
})

test('the shadow share holds the virtual shadow maps of one sun, within a MiB', () => {
  const layout = vsmLayout({ fullMapCapacity: 63, sunMapCapacity: 18 }),
    bytes = ONE_SUN_SHADOW_MAP_BYTES
  // One page-table row; 4096 physical pages a slice, each slice one 256 MiB buffer.
  assert.equal(layout.pageTableRows, 1)
  assert.equal(layout.poolPages, 4096)
  assert.equal(poolSliceBytes(layout), 2 ** 28)
  assert.ok(bytes <= SHADOW_POOL_BYTES, `${bytes} bytes of maps, ${SHADOW_POOL_BYTES} held`)
  assert.ok(SHADOW_POOL_BYTES - bytes < MIB, `${SHADOW_POOL_BYTES - bytes} bytes beside the maps`)
  assert.equal(budget(null).split.shadowPool, SHADOW_POOL_BYTES)
})

test("the CPU total is the page cache's, whole: no shadow table is mirrored on the host", () => {
  for (const total of [1, DEFAULT_CACHED_BYTES, 4096 * MIB])
    assert.equal(budget(null, { cpu: total }).split.pageCache, total, `${total}`)
})

const FIXED = SHADOW_POOL_BYTES + BOUNCE_PROBE_BYTES + EFFECT_TARGET_BYTES

test('a GPU total redraws every pool by the split, and the pools never sum past it', () => {
  for (const total of [FIXED + 2 * MIB, FIXED + 300 * MIB, 8192 * MIB]) {
    const pools = worldPools()
    const handle = budget(null, {}, pools)
    handle.gpu = total
    const { shadowPool, bounceProbes, geometryPool, texturePool } = handle.split
    assert.ok(shadowPool + bounceProbes + geometryPool + texturePool <= total, `${total}`)
    assert.deepEqual(
      { ...pools, pageCache: undefined },
      { gpu: total, geometryPool, texturePool, pageCache: undefined },
    )
    // A pool set alone stays within what the total leaves it.
    handle.geometryPool = DEFAULT_GEOMETRY_POOL_BUDGET
    handle.texturePool = DEFAULT_TEXTURE_POOL_BUDGET
    assert.ok(FIXED + handle.geometryPool + handle.texturePool! <= total, `${total}`)
  }
})

// What the shadows take is sized inside `split.shadowPool` — the virtual shadow maps
// of one sun at the default pool, whatever the device (a device that binds less holds a smaller pool), the screen
// sizing none of it (the projection's mask is a frame target) —, and a total below 512 MiB never
// lets the pools sum past it.
test('the shadow maps fit their share on any device, and totals below 512 MiB never overflow', () => {
  const { shadowPool } = budget(null).split
  assert.ok(ONE_SUN_SHADOW_MAP_BYTES <= shadowPool)
  for (const total of [64 * MIB, 256 * MIB, 511 * MIB, FIXED - 1]) {
    const pools = worldPools()
    const handle = budget(null, {}, pools)
    assert.throws(() => (handle.gpu = total), /GPU_BUDGET_UNDER_SHADOW_POOL/, `${total}`)
    assert.equal(handle.gpu, DEFAULT_GPU_BUDGET, 'a refused total leaves the one in place')
    assert.equal(pools.gpu, undefined)
  }
  const least = budget(null, { gpu: FIXED + 2 }).split
  const { shadowPool: shadows, bounceProbes: probes, geometryPool: g, texturePool: t } = least
  assert.ok(shadows + probes + g + t <= FIXED + 2)
})

test('the GPU total counts the bounce probes as their table holds them, before the pools', () => {
  // The table that names the probe of each cell, whatever the scene: a city's and a room's weigh the same.
  for (const bounds of [
    [0, 0, 0, 8000, 300, 8000],
    [0, 0, 0, 6, 3, 6],
  ]) {
    const { levels, cells } = createBounceCascades(bounds)
    assert.equal(tableBytes(tableExtent(levels.length * cells)), BOUNCE_PROBE_BYTES)
  }
  for (const total of [DEFAULT_GPU_BUDGET, FIXED + 8 * MIB]) {
    const handle = budget(null, { gpu: total })
    const { shadowPool, bounceProbes, geometryPool, texturePool } = handle.split
    assert.equal(bounceProbes, BOUNCE_PROBE_BYTES)
    assert.ok(shadowPool + bounceProbes + geometryPool + texturePool <= total, `${total}`)
  }
})

test('a total the rule cannot take is refused by name and changes nothing', () => {
  const pools = worldPools()
  const handle = budget(null, {}, pools)
  assert.throws(() => (handle.gpu = 0), /INVALID_GPU_BUDGET/)
  // The shadows never shrink: a total under the pool they take is refused, never squeezed.
  assert.throws(() => (handle.gpu = SHADOW_POOL_BYTES - 1), /GPU_BUDGET_UNDER_SHADOW_POOL/)
  assert.equal(handle.split.shadowPool, SHADOW_POOL_BYTES)
  assert.throws(() => (handle.cpu = 1.5), /INVALID_CPU_BUDGET/)
  assert.throws(() => (handle.cpu = 0), /INVALID_CPU_BUDGET/)
  assert.deepEqual({ ...pools, pageCache: undefined }, { pageCache: undefined })
  assert.equal(pools.pageCache.cpuBytes, DEFAULT_CACHED_BYTES)
  handle.cpu = 64 * MIB
  assert.equal(handle.split.pageCache, 64 * MIB)
})

test("a CPU total applies live to the world's page cache, the one every session reads through", () => {
  const pools = worldPools()
  const handle = budget(null, {}, pools)
  const page = new Uint8Array(MIB)
  const urls = Array.from({ length: 8 }, (_, i) => `p${i}`)
  for (const url of urls) pools.pageCache.put(url, page)
  handle.cpu = 3 * MIB
  assert.equal(pools.pageCache.cpuBytes, 3 * MIB)
  // No session reads: pages leave oldest first, at once, not at the next scene load.
  assert.deepEqual(
    urls.filter((url) => pools.pageCache.page(url)),
    ['p5', 'p6', 'p7'],
  )
  // Every session the world opens — a reopen after a device loss among them — reads this cache.
  assert.equal(sessionPools(pools).pageCache, pools.pageCache)
  assert.equal(sessionPools(pools).pageCache, sessionPools(pools).pageCache)
})
