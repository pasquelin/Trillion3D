import test from 'node:test'
import assert from 'node:assert/strict'
import { sessionPools, worldBudget, worldPools, type Pools } from './worldBudget.ts'
import { DEFAULT_TEXTURE_POOL_BUDGET, DEFAULT_GEOMETRY_POOL_BUDGET } from '../../residency/pools.ts'
import { DEFAULT_CPU_BUDGET } from '../../residency/memoryBudget.ts'
import { DEFAULT_CACHED_BYTES } from '../../streaming/pageCache.ts'
import { DEFAULT_PHYSICS_BUDGET } from '../../../../sdk-core/src/physics/index.ts'
import { createBounceCascades, type FrameMetrics } from '../../../../sdk-core/src/index.ts'
import { bounceProbeBytes } from '../../bounce/limits.ts'
import { SHADOW_POOL_BYTES, BOUNCE_PROBE_BYTES } from '../../residency/shadowBudgetBytes.ts'
import {
  DEFAULT_GPU_BUDGET,
  EFFECT_TARGET_BYTES,
  oneSunShadowMaps,
} from '../../residency/budget.fixture.ts'

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

test('raycastTrees reads and sets the raycast tree cache budget', () => {
  const handle = budget(null)
  const before = handle.raycastTrees
  handle.raycastTrees = 1024
  assert.equal(handle.raycastTrees, 1024)
  handle.raycastTrees = before
})
const MiB = 1024 * 1024

test("the default totals split into each pool's own default", () => {
  const handle = budget(null)
  assert.equal(handle.gpu, DEFAULT_GPU_BUDGET)
  assert.equal(handle.cpu, DEFAULT_CPU_BUDGET)
  assert.deepEqual(handle.split, {
    shadowPool: SHADOW_POOL_BYTES,
    bounceProbes: BOUNCE_PROBE_BYTES,
    effectTargets: EFFECT_TARGET_BYTES,
    geometryPool: DEFAULT_GEOMETRY_POOL_BUDGET,
    texturePool: DEFAULT_TEXTURE_POOL_BUDGET,
    pageCache: DEFAULT_CACHED_BYTES,
    textureLevels: (3 * DEFAULT_CACHED_BYTES) / 4,
  })
  assert.equal(handle.geometryPool, DEFAULT_GEOMETRY_POOL_BUDGET)
})

test('the shadow share holds the virtual shadow maps of one sun, within a MiB', () => {
  const { layout, bytes } = oneSunShadowMaps()
  // One page-table row; 2048 physical pages a slice, each slice one 128 MiB part.
  assert.equal(layout.pageTableRows, 1)
  assert.equal(layout.poolPages, 2048)
  assert.equal(layout.poolPartsPerSlice, 1)
  assert.ok(bytes <= SHADOW_POOL_BYTES, `${bytes} bytes of maps, ${SHADOW_POOL_BYTES} held`)
  assert.ok(SHADOW_POOL_BYTES - bytes < MiB, `${SHADOW_POOL_BYTES - bytes} bytes beside the maps`)
  assert.equal(budget(null).split.shadowPool, SHADOW_POOL_BYTES)
})

test("the CPU total is the page cache's, whole: no shadow table is mirrored on the host", () => {
  assert.equal(DEFAULT_CPU_BUDGET, DEFAULT_CACHED_BYTES)
  for (const total of [1, DEFAULT_CPU_BUDGET, 4096 * MiB])
    assert.equal(budget(null, { cpu: total }).split.pageCache, total, `${total}`)
})

const FIXED = SHADOW_POOL_BYTES + BOUNCE_PROBE_BYTES + EFFECT_TARGET_BYTES

test('a GPU total redraws every pool by the split, and the pools never sum past it', () => {
  for (const total of [FIXED + 2 * MiB, FIXED + 300 * MiB, 8192 * MiB]) {
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
// of one sun, on any device: its binding limit splits the pool into parts, never grows it, and the
// screen sizes none of it (the projection's mask is a frame target) —, and a total below 512 MiB
// never lets the pools sum past it.
test('the shadow maps fit their share on any device, and totals below 512 MiB never overflow', () => {
  const { shadowPool } = budget(null).split
  for (const binding of [128 * MiB, 1024 * MiB, 4096 * MiB - 4])
    assert.ok(oneSunShadowMaps(binding).bytes <= shadowPool, `${binding} bytes a binding`)
  for (const total of [64 * MiB, 256 * MiB, 511 * MiB, FIXED - 1]) {
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

test('the GPU total counts the bounce probes at their largest, before the pools', () => {
  // Both copies of a city's cascades — every level followed — are the largest the probes take;
  // a room holds fewer levels and fits inside.
  const city = createBounceCascades([0, 0, 0, 8000, 300, 8000])
  const room = createBounceCascades([0, 0, 0, 6, 3, 6])
  assert.equal(2 * bounceProbeBytes(city.probes), BOUNCE_PROBE_BYTES)
  assert.ok(2 * bounceProbeBytes(room.probes) < BOUNCE_PROBE_BYTES)
  for (const total of [DEFAULT_GPU_BUDGET, FIXED + 8 * MiB]) {
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
  handle.cpu = 64 * MiB
  assert.equal(handle.split.pageCache, 64 * MiB)
})

test("a CPU total applies live to the world's page cache, the one every session reads through", () => {
  const pools = worldPools()
  const handle = budget(null, {}, pools)
  const page = new Uint8Array(MiB)
  for (let i = 0; i < 8; i++) pools.pageCache.touch(`p${i}`, page)
  handle.cpu = 3 * MiB
  assert.equal(pools.pageCache.cpuBytes, 3 * MiB)
  // No session reads: pages leave oldest first, at once, not at the next scene load.
  assert.deepEqual([...pools.pageCache.pages.keys()], ['p5', 'p6', 'p7'])
  // Every session the world opens — a reopen after a device loss among them — reads this cache.
  assert.equal(sessionPools(pools).pageCache, pools.pageCache)
  assert.equal(sessionPools(pools).pageCache, sessionPools(pools).pageCache)
})
