// A spot's map is as wide as its outer cone, clamped in radians and rounded once: at least the
// inner cone (itself within [0, 88.9°]) plus 0.001 rad, at most 88.9° plus 0.001 rad. Its scale,
// the map's x and y, is 1 / tan of that f32 angle.
import test from 'node:test'
import assert from 'node:assert/strict'
import { VsmCacheManager } from './cacheManager.ts'
import { PROJECTION, VIEW } from './clipmap.fixture.ts'
import { addVsmLocalLightShadow, vsmLocalViewData } from './localLight.ts'

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
const WIDEST = (88.9 * Math.PI) / 180

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
