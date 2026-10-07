// A spot's map is as wide as its outer cone, clamped in radians and rounded once: at least the
// inner cone (itself within [0, 88.9°]) plus 0.001 rad, at most 88.9° plus 0.001 rad. Its scale,
// the map's x and y, is 1 / tan of that f32 angle. Its depth is the shared forward perspective
// (`forwardPerspectiveProjection`) between the nearest and farthest caster depths.
import test from 'node:test'
import assert from 'node:assert/strict'
import { VsmCacheManager } from './cacheManager.ts'
import { PROJECTION, VIEW } from './clipmap.fixture.ts'
import { addVsmLocalLightShadow, vsmLocalViewData } from './localLight.ts'
import { DEG2RAD } from '../../../math/src/constants.ts'
import { forwardPerspectiveProjection } from '../../../math/src/projection/forwardZ.ts'
import { HALTON_SWEEP, edgeValues, haltonSpan } from '../../../math/src/sequence/sweep.fixture.ts'

const f32 = Math.fround
const view = vsmLocalViewData(
  { view: VIEW, projection: PROJECTION, perspective: true, eye: [0, 0, 0] },
  { width: 512, height: 384 },
)
/** The scale of the map of a spot of cones `inner` and `outer`. */
function scale(inner: number, outer: number) {
  const spot = {
    ...{ id: 'spot', kind: 'spot' as const, position: [0, 3, -20], direction: [0, -1, 0] },
    ...{ range: 6, coneAngle: outer, innerConeAngle: inner },
  }
  const setup = addVsmLocalLightShadow(new VsmCacheManager(), spot, [view], 0)
  const m = setup.cacheEntry.mapCaches[0].projectionData.lightViewToClip
  assert.equal(m[0], m[5])
  return m[0]
}
const expected = (angle: number) => f32(1 / Math.tan(f32(angle)))
const WIDEST = 88.9 * DEG2RAD

test("a spot's map takes its outer cone, rounded once to an f32", () => {
  for (const outer of [0.1, 0.6, Math.PI / 4, 1.2, 1.5])
    assert.equal(scale(0, outer), expected(outer), `${outer}`)
})

test('the outer cone is held above the inner one and below 88.9° by 0.001 rad', () => {
  assert.equal(scale(0.7, 0.5), expected(0.7 + 0.001))
  assert.equal(scale(-1, 0), expected(0.001))
  assert.equal(scale(0, 1.56), expected(WIDEST + 0.001))
  assert.equal(scale(2, 0.3), expected(WIDEST + 0.001))
})

/** The spot's former projection builder, the oracle: scale 1 written over afterwards, depth row
 *  `−near / (far − near)`, translation `(far · near) / (far − near)`. */
function oldSpotProjection(scale: number, near: number, far: number) {
  const out = new Float64Array(16)
  out[0] = scale
  out[5] = scale
  out[10] = -near / (far - near)
  out[11] = 1
  out[14] = (far * near) / (far - near)
  return out
}

test("a spot's projection is the shared forward perspective, bit for bit, for a range of thickness", () => {
  // Negating a quotient's two operands is exact: near / (near − far) is −near / (far − near) and
  // (−far · near) / (near − far) is (far · near) / (far − near), zeros' signs included.
  // Every edge depth against every other, then the Halton pairs.
  const edges = edgeValues(0, 1e4)
  const near = edges.flatMap(() => edges)
  const far = edges.flatMap((edge) => edges.map(() => edge))
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    near.push(f32(haltonSpan(i, 2, 0.001, 50)))
    far.push(f32(haltonSpan(i, 3, 0.001, 50)))
  }
  const scale = f32(1 / Math.tan(f32(0.6)))
  const now = new Float64Array(16)
  for (let i = 0; i < near.length; i++) {
    if (near[i] === far[i]) continue
    const old = oldSpotProjection(scale, near[i], far[i])
    forwardPerspectiveProjection(now, scale, near[i], far[i])
    for (let k = 0; k < 16; k++)
      assert.ok(Object.is(old[k], now[k]), `near ${near[i]} far ${far[i]} entry ${k}`)
  }
})

test('a spot of no depth range (its range rounds to 0.001 m) takes a finite projection', () => {
  // Declared fix: the former builder divided by far − near = 0 there, entries 10 and 14 ±Infinity
  // and the map broken; the shared one projects every depth to near / z.
  assert.ok(!oldSpotProjection(1, f32(0.001), f32(0.001)).every(Number.isFinite))
  const spot = {
    ...{ id: 'spot', kind: 'spot' as const, position: [0, 3, -20], direction: [0, -1, 0] },
    ...{ range: 0.001, coneAngle: 0.6, innerConeAngle: 0 },
  }
  const setup = addVsmLocalLightShadow(new VsmCacheManager(), spot, [view], 0)
  const m = setup.cacheEntry.mapCaches[0].projectionData.lightViewToClip
  assert.equal(m[10], 0, 'the spot meets near === far')
  assert.ok(Array.from(m).every(Number.isFinite))
})
