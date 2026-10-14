// The GPU frustum verdict (`verdictWgsl.ts`), its shipped text run in JavaScript (`shaderRun`),
// against its contract on adversarial scenes — one-ulp straddles, NaN, infinite and signed-zero
// boxes and planes, items with no box, hidden and parked items, paged items the cut emptied: it
// keeps every item the exact double test keeps (`verdict.fixture.ts`, the float64 oracle), and
// differs from it only on boxes within its rounding margin of a plane.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts'
import { surfaceOf } from '../../page/surface.ts'
import type { PlacementOf } from '../../placement/rows.ts'
import { NO_INDEX } from '../../../../math/src/constants.ts'
import { hasBit } from '../../../../math/src/scalar/bits.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'
import { gpuVerdict } from './verdictRun.fixture.ts'
import { orderBlendPasses } from './order.ts'
import { blendSceneOf } from './plan.fixture.ts'
import { blendVerdictCpu } from './verdict.fixture.ts'
import { WATER_RANK_SHIFT } from '../water/rank.ts'
import { FLUSH, ROUNDING_GAMMA } from '../../../../math/src/float/guards.ts'
import type { BlendGpuItem } from './state.ts'

const EDGES = [NaN, Infinity, -Infinity, -0, 0, Number.MAX_VALUE, -Number.MAX_VALUE, 5e-324]

/** A box near the frustum's planes, a bound sometimes one ulp across, or a special value. */
function box(next: () => number, edges: boolean) {
  const c = [0, 1, 2].map(() => (next() - 0.5) * 40),
    r = next() * 6
  const bounds = new Float64Array([c[0] - r, c[1] - r, c[2] - r, c[0] + r, c[1] + r, c[2] + r])
  if (next() < 0.2) {
    // One bound moved onto the axis plane x = 10, or one ulp either side of it.
    const side = next() < 0.5 ? 0 : 3
    bounds[side] = [10 - 2 ** -49, 10, 10 + 2 ** -49][Math.floor(next() * 3)]
  }
  if (edges && next() < 0.1)
    bounds[Math.floor(next() * 6)] = EDGES[Math.floor(next() * EDGES.length)]
  return bounds
}

/** Six planes: an axis box around the origin with one face on x = 10, or random half-spaces. */
function planes(into: Float64Array, next: () => number, edges: boolean) {
  for (let p = 0; p < 6; p++) {
    const axis = p >> 1,
      sign = p & 1 ? -1 : 1
    const tilted = next() < 0.3
    const n = tilted ? [next() - 0.5, next() - 0.5, next() - 0.5] : [0, 0, 0]
    if (!tilted) n[axis] = sign
    into.set([n[0], n[1], n[2], p === 1 ? 10 : 5 + next() * 20], p * 4)
  }
  if (edges && next() < 0.3)
    into[Math.floor(next() * 24)] = EDGES[Math.floor(next() * EDGES.length)]
}

/** A scene of `count` items, its paged ranks and their counts as the compaction left them. */
function scene(count: number, next: () => number, edges: boolean) {
  const items: BlendGpuItem[] = []
  let water = 0
  for (let i = 0; i < count; i++) {
    const transmissive = next() < 0.25
    items.push({
      surface: surfaceOf(G.basicSurface({ side: Math.floor(next() * 3) })),
      matrix: new Matrix4().makeTranslation(next() * 50, 0, next() * 50),
      count: 3,
      transmissive,
      flags: transmissive ? ++water << WATER_RANK_SHIFT : 0,
      hidden: next() < 0.1,
      bounds: next() < 0.9 ? box(next, edges) : undefined,
      placement: {
        rows: { live: new Uint8Array([next() < 0.1 ? 0 : 1]) },
        index: 0,
      } as unknown as PlacementOf,
    } as unknown as BlendGpuItem)
  }
  const blendState = blendSceneOf(items)
  blendState.transmissive = water
  planes(blendState.blendPlanes, next, edges)
  // Paged items read the compaction's count at their paged rank: some the cut emptied.
  const counts: number[] = []
  items.forEach((_, i) => {
    if (next() >= 0.5) return
    blendState.drawsPacked[i * 4] = counts.length / 4
    counts.push(0, next() < 0.3 ? 0 : 1 + Math.floor(next() * 9), 0, 0)
  })
  orderBlendPasses(blendState, [0, 0, 0])
  return { blendState, counts }
}

/** Whether the exact test's verdict on `box` may differ from the kernel's: a number the kernel
 *  leaves out of single precision, or a plane the box lies behind within twice its margin. */
function marginal(planes: Float64Array, box: Float64Array) {
  const bounded = (v: number) => Math.abs(v) < 2 ** 60
  if (!box.every(bounded) || !planes.every(bounded)) return true
  for (let p = 0; p < 24; p += 4) {
    const [a, b, c, d] = planes.subarray(p, p + 4)
    const x = a > 0 ? box[3] : box[0],
      y = b > 0 ? box[4] : box[1],
      z = c > 0 ? box[5] : box[2]
    const s = a * x + b * y + c * z + d,
      m = Math.abs(a * x) + Math.abs(b * y) + Math.abs(c * z) + Math.abs(d),
      r = Math.abs(a) + Math.abs(b) + Math.abs(c) + Math.abs(x) + Math.abs(y) + Math.abs(z)
    if (s < 0 && s >= -2 * (ROUNDING_GAMMA * m + FLUSH * (1 + r))) return true
  }
  return false
}

function check(count: number, seed: number, edges: boolean) {
  const { blendState, counts } = scene(count, lcgRandom(seed), edges)
  // The compaction's four words a paged rank, its instance count the second.
  const instances = counts.filter((_, word) => word % 4 === 1)
  const gpu = gpuVerdict(blendState, counts),
    exact = blendVerdictCpu(blendState, instances),
    at = `seed ${seed}, ${count} items`
  blendState.blendGpu.forEach((item, i) => {
    const kept = hasBit(gpu.keep, i)
    assert.ok(kept || !hasBit(exact.keep, i), `${at}: item ${i} culled, the exact test keeps it`)
    if (kept !== hasBit(exact.keep, i))
      assert.ok(marginal(blendState.blendPlanes, item.bounds!), `${at}: item ${i} off the margin`)
  })
  assert.ok(gpu.rejected <= exact.rejected, `${at}: no more rejected`)
  assert.ok(gpu.inView >= exact.inView, `${at}: no less in view`)
  exact.waterDraws.forEach((draws, rank) =>
    assert.ok(gpu.waterDraws[rank] >= draws, `${at}: water rank ${rank} drawn`),
  )
  // Words past the scene's are written by none: the keep words cover the items exactly.
  assert.equal(gpu.keep.length, exact.keep.length)
}

test('random scenes: every item the exact test keeps is kept, the rest only in the margin', () => {
  for (let seed = 1; seed <= 16; seed++) check(150, seed, false)
})

test('NaN, infinite and signed-zero boxes and planes, one-ulp straddles: never a visible cull', () => {
  for (let seed = 101; seed <= 124; seed++) check(150, seed, true)
})

test('empty groups and the word edges', () => {
  for (const count of [1, 31, 32, 33, 63, 64, 65, 97]) check(count, 300 + count, true)
})

test('a box a rounding outside a plane is kept; one a unit outside is rejected', () => {
  const near = scene(2, lcgRandom(7), false)
  const items = near.blendState.blendGpu
  // Six axis planes around the origin, the first `x ≤ 10`; no item paged.
  for (let p = 0; p < 6; p++) {
    const n = [0, 0, 0]
    n[p >> 1] = p & 1 ? 1 : -1
    near.blendState.blendPlanes.set([n[0], n[1], n[2], 10], p * 4)
  }
  near.blendState.drawsPacked.fill(NO_INDEX)
  const outside = [10 + 2 ** -30, 11]
  items.forEach((item, i) =>
    Object.assign(item, {
      hidden: false,
      transmissive: false,
      flags: 0,
      placement: { rows: { live: new Uint8Array([1]) }, index: 0 },
      bounds: new Float64Array([outside[i], 0, 0, outside[i] + 1, 1, 1]),
    }),
  )
  orderBlendPasses(near.blendState, [0, 0, 0])
  const gpu = gpuVerdict(near.blendState, [])
  assert.ok(hasBit(gpu.keep, 0), 'a box single precision cannot tell from the plane stays')
  assert.ok(!hasBit(gpu.keep, 1), 'a box well outside goes')
  assert.equal(gpu.rejected, 1)
})
