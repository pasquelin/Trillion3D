import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../scene/host/graph/graph.fixture.ts'
import { Matrix4 } from '../../../sdk-core/src/world/math/matrix4.ts'
import { surfaceOf } from '../geometry/pages/surface.ts'
import { orderBlendPasses } from './order/order.ts'
import { planItem, refreshBlendPlan } from './plan/plan.ts'
import { buildBlendStatics } from './statics.ts'
import { blendSceneOf, paintOutcome, referenceOrder } from './plan/plan.fixture.ts'
import { cpuModel } from './expand/expandCpu.fixture.ts'
import { precedes } from './paintOrder.ts'
import { sortSeedsFarToNear } from './sortPlan.ts'
import { PLAN_SHIFT } from './plan/planEntry.ts'
import type { BlendGpuItem } from './state.ts'
import { lcgRandom } from '../../../math/src/sequence/random.ts'

type BlendState = ReturnType<typeof blendSceneOf>

/** A frame ranked by `orderBlendPasses`: the whole paint order, and the own entries the CPU
 *  ranked itself, both checked against `referenceOrder`. */
function rankAndCheck(blendState: BlendState, eye: number[], what: string) {
  orderBlendPasses(blendState, eye)
  const { order, ownSeeds } = paintOutcome(blendState)
  const seeds = blendState.seeds
  const expected = referenceOrder(seeds, blendState.orderKeys, blendState.orderPriorities)
  assert.deepEqual(order, seeds.length ? expected : [], what)
  const own = new Set(ownSeeds.map((seed) => seeds[seed]))
  assert.deepEqual(
    ownSeeds.map((seed) => seeds[seed]),
    expected.filter((entry) => own.has(entry)),
    `${what}, own entries`,
  )
}

const SIDES = [0, 1, 2]
const EDGES = [NaN, Infinity, -Infinity, -0, 0, Number.MAX_VALUE]

/** Items on a coarse grid, so equal keys are common; `edges` puts special values in some boxes. */
function scene(count: number, seed: number, edges = false) {
  const next = lcgRandom(seed)
  const pick = (n: number) => Math.floor(next() * n)
  const items: BlendGpuItem[] = []
  for (let i = 0; i < count; i++) {
    const x = pick(7) - 3,
      y = pick(7) - 3,
      z = pick(7) - 3
    const bounds = new Float64Array([x - 1, y - 1, z - 1, x + 1, y + 1, z + 1])
    if (edges && next() < 0.2) bounds[pick(6)] = EDGES[pick(EDGES.length)]
    const matrix = new Matrix4().makeTranslation(x, y, z)
    items.push({
      surface: surfaceOf(G.basicSurface({ side: SIDES[pick(3)] })),
      matrix,
      count: 3,
      paged: next() < 0.7,
      transmissive: next() < 0.2,
      bounds: next() < 0.9 ? bounds : undefined,
    } as unknown as BlendGpuItem)
  }
  const blendState = blendSceneOf(items)
  // Rejects nothing: every plane passes the whole space.
  for (let p = 0; p < 6; p++) blendState.blendPlanes.set([0, 0, 0, 1], p * 4)
  return { blendState, next }
}

/** Frames of small steps, camera jumps, and the events that void or replace the plan. */
function walk(count: number, seed: number, frames: number, edges = false) {
  const { blendState, next } = scene(count, seed, edges)
  let eye = [0, 0, 0]
  for (let frame = 0; frame < frames; frame++) {
    const roll = next()
    if (roll < 0.35) eye = eye.map((v) => v + Math.round((next() - 0.5) * 2))
    else if (roll < 0.6) eye = [0, 1, 2].map(() => Math.round((next() - 0.5) * 40))
    else if (roll < 0.65) orderBlendPasses(blendState, undefined)
    else if (roll < 0.7) refreshBlendPlan(blendState)
    else if (roll < 0.75) {
      // A remount: new statics, then the plan they need.
      buildBlendStatics(blendState, blendState.uniformStride)
      refreshBlendPlan(blendState)
    }
    rankAndCheck(blendState, eye, `seed ${seed}, frame ${frame}`)
  }
}

test('the paint order is the total order of the keys, own entries included, on random walks', () => {
  for (let seed = 1; seed <= 12; seed++) walk(60, seed, 40)
})

test('camera jumps over hundreds of entries give the same order', () => {
  for (let seed = 21; seed <= 24; seed++) walk(600, seed, 12)
})

test('NaN, infinite, signed zero and huge keys give the same order', () => {
  for (let seed = 31; seed <= 40; seed++) walk(300, seed, 16, true)
})

/** The first three items the blend pass paints, a double-sided item's two entries counted once. */
const nanHead = (blendState: BlendState) =>
  [...new Set(paintOutcome(blendState).order.map(planItem))].slice(0, 3)

test('a NaN key ranks farthest, by rank among NaNs, whatever the previous frame left', () => {
  const { blendState } = scene(400, 41)
  for (const rank of [7, 3, 250]) {
    blendState.blendGpu[rank].bounds = new Float64Array([-Infinity, 0, 0, Infinity, 0, 0])
    blendState.blendGpu[rank].transmissive = false
  }
  refreshBlendPlan(blendState)
  for (const eye of [
    [30, 30, 30],
    [-30, -30, -30],
  ]) {
    rankAndCheck(blendState, eye, `eye ${eye}`)
    assert.deepEqual(nanHead(blendState), [3, 7, 250], 'the NaN keys first, in rank order')
  }
  // From any previous order: the order is the total one, not one the history decides.
  cpuModel(blendState).order.reverse()
  blendState.ownSeeds.reverse()
  rankAndCheck(blendState, [-30, -30, -30], 'from reversed orders')
  assert.deepEqual(nanHead(blendState), [3, 7, 250])
})

test('precedes is a total order, NaN farthest', () => {
  const keys = [NaN, Infinity, 5, 0, -0, NaN]
  for (const [a, keyA] of keys.entries())
    for (const [b, keyB] of keys.entries()) {
      if (a === b) continue
      assert.notEqual(
        precedes(0, keyA, a, 0, keyB, b),
        precedes(0, keyB, b, 0, keyA, a),
        `${keyA}#${a} against ${keyB}#${b}: exactly one recedes`,
      )
    }
  assert.equal(precedes(0, Infinity, 0, 0, NaN, 1), true, 'an infinite key recedes behind a NaN')
  assert.equal(precedes(0, NaN, 2, 0, NaN, 1), true, 'NaN keys by rank')
})

test('empty, single-item and single-pass scenes', () => {
  for (const count of [1, 2, 3]) walk(count, 50 + count, 8)
  const blendState = blendSceneOf([])
  orderBlendPasses(blendState, [0, 0, 0])
  assert.equal(blendState.runCount, 0)
})

test('the merge sort reaches the one sorted list, from any start', () => {
  const sortedFrom = (keys: number[], start: number[]) => {
    const seeds = Uint32Array.from(keys.keys(), (item) => item << PLAN_SHIFT),
      order = Uint32Array.from(start)
    sortSeedsFarToNear(order, seeds, Float64Array.from(keys), new Int32Array(keys.length))
    return Array.from(order)
  }
  const expected = (keys: number[]) =>
    Array.from(keys.keys()).sort((a, b) =>
      precedes(0, keys[a], a, 0, keys[b], b) ? 1 : precedes(0, keys[b], b, 0, keys[a], a) ? -1 : 0,
    )
  // A sorted head, a reversed middle, then a tail due at the very front.
  const keys = [
    ...Array.from({ length: 10 }, (_, i) => 1000 - i),
    ...Array.from({ length: 380 }, (_, i) => i + 1),
    ...Array.from({ length: 10 }, () => 5000),
  ]
  assert.deepEqual(sortedFrom(keys, [...keys.keys()]), expected(keys), 'late jump')
  const next = lcgRandom(71)
  for (let trial = 0; trial < 50; trial++) {
    const n = 1 + Math.floor(next() * 500),
      start = Array.from({ length: n }, (_, rank) => rank)
    // Mostly sorted, with a random stretch shuffled.
    const from = Math.floor(next() * n),
      to = from + Math.floor(next() * (n - from))
    for (let i = to; i > from; i--) {
      const j = from + Math.floor(next() * (i - from + 1))
      ;[start[i], start[j]] = [start[j], start[i]]
    }
    const trialKeys = Array.from({ length: n }, (_, rank) => n - rank - (rank % 3))
    assert.deepEqual(sortedFrom(trialKeys, start), expected(trialKeys), `trial ${trial}`)
  }
})
