import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_GEOMETRY_POOL_BUDGET,
  DEFAULT_TEXTURE_POOL_BUDGET,
  geometryPoolFor,
} from './pools.ts'
import { laneCounts, poolEncoding } from '../texture/blockFormats.ts'
import { TILES_PER_LAYER } from '../texture/tiles.ts'
import { texturePoolFor } from '../webgpu/residency/memoryBudgets.ts'
import { DEFAULT_CPU_BUDGET, defaultGpuBudget, splitMemoryBudget } from './memoryBudget.ts'
import type { ActiveGpuMemory } from './activeMemory.ts'
import { worldRootsFixture } from '../../../sdk-core/src/manifest/worldRoots.fixture.ts'
import { SHADOW_POOL_BYTES, BOUNCE_PROBE_BYTES } from './shadowBudgetBytes.ts'
import { DEFAULT_GPU_BUDGET } from './budget.fixture.ts'

// The million-page/300-root pool fixture of pools.test.ts, using the actual floor rule.
const geometryMinimum = geometryPoolFor({
  budgetBytes: 1,
  pageBytes: 1500,
  uniquePages: 1_000_000,
  rootPages: 300,
}).allocatedBytes
// The asymmetric tail fixture of poolGrants.test.ts, using its real lane/layer rule.
const encoding = poolEncoding('bc7')
const textureMinimum = texturePoolFor(
  1,
  undefined,
  {
    color: { ...laneCounts(), lossless: 5000 },
    data: { ...laneCounts(), rgba: 20000 },
  },
  encoding.texelBytes,
  {
    color: { ...laneCounts(), lossless: 2 * TILES_PER_LAYER + 1 },
    data: laneCounts(),
  },
).allocatedBytes
const full: ActiveGpuMemory = {
  frameTargets: 1274573696,
  frameShare: 1274573696,
  shadowPool: SHADOW_POOL_BYTES,
  shadowReserve: 0,
  bounceProbes: BOUNCE_PROBE_BYTES,
  effectTargets: 22112160,
  geometryMinimum,
  textureMinimum,
}

test('active admission uses real pool floors and does not charge inactive fixed reservations', () => {
  const active = { ...full, shadowPool: 0, effectTargets: 0 }
  const split = splitMemoryBudget(DEFAULT_GPU_BUDGET, DEFAULT_CPU_BUDGET, undefined, active)
  assert.equal(split.shadowPool, 0)
  assert.equal(split.effectTargets, 0)
  assert.equal(split.frameTargets, active.frameTargets)
  assert.ok(split.geometryPool >= geometryMinimum)
  assert.ok(split.texturePool >= textureMinimum)
  assert.ok(
    split.geometryPool + split.texturePool + active.frameTargets + active.bounceProbes <=
      DEFAULT_GPU_BUDGET,
  )
})

test('the asymmetric real tail floor is admitted exactly or refused, never silently raised', () => {
  assert.equal(geometryMinimum, 450000)
  assert.equal(textureMinimum, 218103808)
  const active = { ...full, shadowPool: 0, effectTargets: 0, bounceProbes: 0 }
  const exact = active.frameTargets + geometryMinimum + textureMinimum
  const split = splitMemoryBudget(exact, DEFAULT_CPU_BUDGET, undefined, active)
  assert.equal(split.geometryPool, geometryMinimum)
  assert.equal(split.texturePool, textureMinimum)
  assert.throws(
    () => splitMemoryBudget(exact - 1, DEFAULT_CPU_BUDGET, undefined, active),
    /UNDER_MINIMUM/,
  )
})

// The default effect reserve holds no extra scene target (#1483, `effectChainBytesAt`): the
// 4K reservations now fall short with or without the frame's history, by the bytes named.
test('full 4K reservations expose the concrete tail-fixture shortfall instead of overcommitting', () => {
  const required = geometryMinimum + textureMinimum
  for (const frameTargets of [full.frameTargets, full.frameTargets - 265420800]) {
    const fixed = frameTargets + full.shadowPool + full.bounceProbes + full.effectTargets
    assert.throws(
      () =>
        splitMemoryBudget(DEFAULT_GPU_BUDGET, DEFAULT_CPU_BUDGET, undefined, {
          ...full,
          frameTargets,
        }),
      new RegExp(`UNDER_MINIMUM: available=${DEFAULT_GPU_BUDGET - fixed}, required=${required}$`),
    )
  }
})

test('the default total of those 4K reservations funds them, each pool at its default', () => {
  const split = splitMemoryBudget(
    defaultGpuBudget(undefined, full),
    DEFAULT_CPU_BUDGET,
    undefined,
    full,
  )
  assert.equal(split.geometryPool, DEFAULT_GEOMETRY_POOL_BUDGET)
  assert.equal(split.texturePool, DEFAULT_TEXTURE_POOL_BUDGET)
})

test("shadows still to be made take the pools' room, never under their floors", () => {
  const active = { ...full, shadowPool: 0, effectTargets: 0, bounceProbes: 0 }
  const total = active.frameTargets + geometryMinimum + textureMinimum + 64 * 2 ** 20
  const free = splitMemoryBudget(total, DEFAULT_CPU_BUDGET, undefined, active)
  const reserved = { ...active, shadowReserve: 16 * 2 ** 20 }
  const less = splitMemoryBudget(total, DEFAULT_CPU_BUDGET, undefined, reserved)
  assert.equal(
    free.geometryPool + free.texturePool - less.geometryPool - less.texturePool,
    16 * 2 ** 20,
  )
  // More than the room: the pools at their floors, the frame never refused for it.
  const short = { ...active, shadowReserve: 2 ** 30 }
  const floors = splitMemoryBudget(total, DEFAULT_CPU_BUDGET, undefined, short)
  assert.deepEqual([floors.geometryPool, floors.texturePool], [geometryMinimum, textureMinimum])
})

test('invalid reservations cannot create artificial space in the global budget', () => {
  for (const value of [-1, NaN, Infinity, 0.5])
    assert.throws(
      () =>
        splitMemoryBudget(DEFAULT_GPU_BUDGET, DEFAULT_CPU_BUDGET, undefined, {
          ...full,
          frameTargets: value,
        }),
      /INVALID_GPU_RESERVATION/,
    )
})

test('the existing open-world cell fixture keeps its pinned top and held-cell roots beside 4K history', () => {
  const { table } = worldRootsFixture()
  const held = new Set([0, ...table.cells.objects(0).flatMap((object) => object.dependencies)])
  const roots = [...held].reduce((count, bundle) => count + table.bundles[bundle].count, 0)
  const pageBytes = Math.max(...table.bundles.map((bundle) => bundle.bytes / bundle.count))
  const floor = geometryPoolFor({
    budgetBytes: 1,
    pageBytes,
    uniquePages: table.pages.count,
    rootPages: roots,
  })
  const active = {
    ...full,
    geometryMinimum: floor.allocatedBytes,
    textureMinimum: 0,
    shadowPool: 0,
    effectTargets: 0,
  }
  const split = splitMemoryBudget(DEFAULT_GPU_BUDGET, DEFAULT_CPU_BUDGET, undefined, active)
  const pool = geometryPoolFor({
    budgetBytes: split.geometryPool,
    pageBytes,
    uniquePages: table.pages.count,
    rootPages: roots,
  })
  assert.equal(roots, 3, 'world top plus both bundles required by the placed cell')
  assert.ok(pool.slots >= roots)
  assert.ok(
    split.geometryPool + split.texturePool + active.frameTargets + active.bounceProbes <=
      DEFAULT_GPU_BUDGET,
  )
})
