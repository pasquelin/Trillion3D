// A spot's map is as wide as its outer cone, the one the light is lit by (`spotAnglesOf`: at least
// the inner cone, itself within [0, 88.9°], plus 0.001 rad, at most 88.9° plus 0.001 rad). Its
// scale, the map's x and y, is 1 / tan of that angle, rounded once to an f32. Its depth is the shared forward perspective
// (`forwardPerspectiveProjection`) between the nearest and farthest caster depths. Declared change
// (the lead's decision, recorded in the pull request), outside class 1 for that spot alone: a spot
// whose depth range rounds to nothing (near === far) takes the shared builder's finite projection
// where the former one wrote ±Infinity.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { wgslConstants } from '../../../materials/texture/shaderRule.fixture.ts'
import { Mat } from '../../../materials/texture/shaderRunMatrix.fixture.ts'
import { VSM_TESS_VIEW_WGSL } from './tessellation/shadowViewWgsl.ts'
import { VsmCacheManager } from './cacheManager.ts'
import { PROJECTION, VIEW } from './clipmap.fixture.ts'
import { addVsmLocalLightShadow, vsmLocalViewData } from './localLight.ts'
import { projectionLight } from './frame/vsmPlan.ts'
import { spotConesOf } from '../../../../../sdk-core/src/scene/light/fields.ts'
import { spotAnglesOf } from '../../../../../sdk-core/src/scene/light/spotAngles.ts'
import type { SceneLight } from '../../../../../sdk-core/src/scene/light/contracts.ts'
import { DEG2RAD } from '../../../../../math/src/constants.ts'
import { forwardPerspectiveProjection } from '../../../../../math/src/projection/forwardZ.ts'
import {
  HALTON_SWEEP,
  edgeValues,
  haltonSpan,
} from '../../../../../math/src/sequence/sweep.fixture.ts'
const view = vsmLocalViewData(
  { view: VIEW, projection: PROJECTION, perspective: true, eye: [0, 0, 0] },
  { width: 512, height: 384 },
)
/** The scale of the map of a spot whose outer cone is `outerCone`. */
function scale(outerCone: number) {
  const spot = {
    ...{ id: 'spot', kind: 'spot' as const, position: [0, 3, -20], direction: [0, -1, 0] },
    ...{ range: 6, outerCone },
  }
  const setup = addVsmLocalLightShadow(new VsmCacheManager(), spot, [view])
  const m = setup.cacheEntry.mapCaches[0].projectionData.lightViewToClip
  assert.equal(m[0], m[5])
  return m[0]
}
const expected = (angle: number) => Math.fround(1 / Math.tan(angle))
const WIDEST = 88.9 * DEG2RAD

test("a spot's map takes the outer cone it is given, its scale rounded once to an f32", () => {
  for (const outer of [0.1, 0.3, 0.6, Math.PI / 4, 0.9, 1.2, 1.5])
    assert.equal(scale(outer), expected(outer), `${outer}`)
})

test('the outer cone is held above the inner one and below 88.9° by 0.001 rad', () => {
  const held = (inner: number, outer: number) => scale(spotAnglesOf(inner, outer)[1])
  assert.equal(held(0.7, 0.5), expected(0.7 + 0.001))
  assert.equal(held(-1, 0), expected(0.001))
  assert.equal(held(0, 1.56), expected(WIDEST + 0.001))
  assert.equal(held(2, 0.3), expected(WIDEST + 0.001))
})

test('the projection takes the outer cone the lighting lights the spot by', () => {
  const base = { id: 's', kind: 'spot', position: [0, 3, 0], direction: [0, -1, 0], range: 6 }
  const spot = { ...base, color: [1, 1, 1], intensity: 1, castsShadow: true, outerConeAngle: 0.8 }
  for (const innerConeAngle of [undefined, 0.4, 0.8]) {
    const light = { ...spot, innerConeAngle } as SceneLight
    const projected = projectionLight(light, 8192)
    assert.equal(projected.type === 'spot' && projected.coneAngle, spotConesOf(light)[1])
  }
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
    near.push(Math.fround(haltonSpan(i, 2, 0.001, 50)))
    far.push(Math.fround(haltonSpan(i, 3, 0.001, 50)))
  }
  const scale = Math.fround(1 / Math.tan(Math.fround(0.6)))
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
  assert.ok(!oldSpotProjection(1, Math.fround(0.001), Math.fround(0.001)).every(Number.isFinite))
  const spot = {
    ...{ id: 'spot', kind: 'spot' as const, position: [0, 3, -20], direction: [0, -1, 0] },
    ...{ range: 0.001, outerCone: 0.601 },
  }
  const setup = addVsmLocalLightShadow(new VsmCacheManager(), spot, [view])
  const m = setup.cacheEntry.mapCaches[0].projectionData.lightViewToClip
  assert.equal(m[10], 0, 'the spot meets near === far')
  assert.ok(Array.from(m).every(Number.isFinite))
})

// The patches of a displaced surface are cut and judged by the view of the window of shadow map pages
// their record draws (`vsmTessView`, `vsmTessOnWindow`, `./tessellation/shadowViewWgsl.ts`), from the
// map's record. (A pair drew one page; a record draws a window of up to four pages a side.)
const TESS_VIEW = wgslBlock('tessView', [VSM_TESS_VIEW_WGSL], '')
const tessView = shaderRun<{
  vsmTessView(raw: object, mip: number): Record<string, unknown>
  vsmTessOnWindow(box: object, world: Mat, raw: object, record: number[]): boolean
}>(TESS_VIEW, ['vsmTessView', 'vsmTessOnWindow'], {
  ...wgslConstants(TESS_VIEW),
  tu: { edgesPerPixel: 0.5 },
})
const dot3 = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!

/** The record of a spot's map the shader reads, from the host's projection data. */
function spotRecord() {
  const spot = {
    ...{ id: 'spot', kind: 'spot' as const, position: [0, 3, -20], direction: [0, -1, 0] },
    ...{ range: 6, outerCone: 0.601 },
  }
  const d = addVsmLocalLightShadow(new VsmCacheManager(), spot, [view]).cacheEntry.mapCaches[0]
    .projectionData
  return {
    lightViewToClip: new Mat(Array.from(Float32Array.from(d.lightViewToClip))),
    shiftedToMapUv: new Mat(Array.from(Float32Array.from(d.shiftedToMapUv))),
    originShiftHigh: Array.from(Float32Array.from(d.originShift)),
    originShiftLow: [0, 0, 0],
    d,
  }
}

test('a map’s view measures depth from its light along its axis, from its near plane, in the pixels its mip draws', () => {
  const raw = spotRecord()
  const v = tessView.vsmTessView(raw, 0) as {
    forward: number[]
    eye: number[]
    near: number
    edgesPerUnit: number
    perspective: boolean
  }
  assert.equal(v.perspective, true)
  assert.deepEqual(v.eye.map(Math.fround), [0, 3, -20])
  // The depth of a point two metres along the cone's axis is two, and one metre off it too.
  const depth = (p: number[]) =>
    dot3(
      v.forward,
      p.map((x, i) => x - v.eye[i]!),
    )
  assert.ok(Math.abs(depth([0, 1, -20]) - 2) < 1e-4)
  assert.ok(Math.abs(depth([1, 1, -20]) - 2) < 1e-4)
  // Its near plane is where the projection's reversed depth reaches one: z / w of a point at depth `near`.
  const clip = raw.d.lightViewToClip
  assert.ok(v.near > 0 && Math.abs((clip[10]! * v.near + clip[14]!) / v.near - 1) < 1e-4)
  // The pixels a unit subtends at depth one: half the map's scale over its width in texels, over the
  // threshold; a mip draws a map half as wide.
  const wide = 0.5 * clip[5]! * 16384 * 0.5
  assert.ok(Math.abs(v.edgesPerUnit - wide) < 1e-2 * wide)
  const mip1 = tessView.vsmTessView(raw, 1) as { edgesPerUnit: number }
  assert.ok(Math.abs(mip1.edgesPerUnit - wide / 2) < 1e-2 * wide)
})

test('a patch is on the window its record draws only where its box reaches those pages of the map', () => {
  const raw = spotRecord()
  const identity = new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  // Two metres below the light on its axis, 0.1 m across: the map’s centre, pixel 8192 of 16384.
  const box = { lo: [-0.05, 0.95, -20.05], hi: [0.05, 1.05, -19.95] }
  // A window of one page (`VSM_RENDER_RECORD_WGSL`: first page in z's low half, last in its high).
  const pair = (page: number, mip = 0, last = page) => [
    0,
    mip << 16,
    (page | (page << 8) | (last << 16) | (last << 24)) >>> 0,
    1,
  ]
  assert.equal(tessView.vsmTessOnWindow(box, identity, raw, pair(64)), true, 'the centre page')
  assert.equal(tessView.vsmTessOnWindow(box, identity, raw, pair(63)), true, 'the one before it')
  assert.equal(tessView.vsmTessOnWindow(box, identity, raw, pair(0)), false, 'a corner of the map')
  assert.equal(
    tessView.vsmTessOnWindow(box, identity, raw, pair(60, 0, 63)),
    true,
    'a window to it',
  )
  assert.equal(tessView.vsmTessOnWindow(box, identity, raw, pair(56, 0, 59)), false, 'one before')
  assert.equal(tessView.vsmTessOnWindow(box, identity, raw, pair(127)), false, 'the other corner')
  // At the next mip the map is half as wide: the same point lies on a page half as far.
  assert.equal(tessView.vsmTessOnWindow(box, identity, raw, pair(32, 1)), true)
  assert.equal(tessView.vsmTessOnWindow(box, identity, raw, pair(64, 1)), false)
  // A box beside the cone, past its edge, reaches no page of the map.
  const away = { lo: [40, 0.95, -20.05], hi: [40.1, 1.05, -19.95] }
  assert.equal(tessView.vsmTessOnWindow(away, identity, raw, pair(64)), false)
})
