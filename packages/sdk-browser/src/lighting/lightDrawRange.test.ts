// The lights a perspective view draws: a light too small on the screen or past its draw distance
// is left out — of the shadow plan and of the light grid both —, an orthographic view and a sun
// leave out none. A spot is measured by the sphere of its cone, not by its position and range. The
// light's record holds the share and the greatest distance; the view brings its eye and its factor.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LIGHT_UNDRAWN_SHIFT,
  SCENE_LIGHT_FLOATS,
  type SceneLight,
} from '../../../sdk-core/src/scene/light/contracts.ts'
import {
  DRAW_FARTHEST,
  DRAW_LANES,
  DRAW_SHARE,
  LIGHT_FIELD,
  baseOf,
} from '../../../sdk-core/src/scene/light/fields.ts'
import { createSceneLightStore } from '../../../sdk-core/src/scene/light/store.ts'
import {
  coneSphereAlong,
  coneSphereRadius,
  drawShareOf,
  inDrawRange,
  type LightRangeView,
} from '../../../sdk-core/src/scene/light/drawRange.ts'
import { perspectiveProjection } from '../../../math/src/projection/camera.ts'
import { fakeDevice } from '../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { LIGHT_BUFFER_AT } from '../frame/backend/state/lightBufferLayout.ts'
import { createDrawnLights, drawLights, lightDrawViewOf, lightDrawn } from './lightDrawRange.ts'
import { vsmLightSeen, vsmSeenPlanes } from './shadows/vsm/seenLights.ts'

const SETTINGS: LightRangeView = { lightMinScreenRadius: 0.03, lightMaxDrawDistanceScale: 1 }
const eye = new Float64Array(3)
const lamp = (z: number, range: number, more: Partial<SceneLight> = {}): SceneLight => ({
  id: 'lamp',
  kind: 'point',
  position: [0, 0, z],
  range,
  color: [1, 1, 1],
  intensity: 1,
  castsShadow: true,
  ...more,
})
/** The store that holds `light` under the settings `settings`, its slot and a view of it from the origin at the factor `factor`. */
function held(light: SceneLight, settings: Partial<LightRangeView> = {}, factor = 1) {
  const lights = createSceneLightStore()
  lights.setRangeView({ ...SETTINGS, ...settings })
  const slot = lights.add(light)
  return { lights, slot, view: { eye, factor, lights } }
}
const drawn = (light: SceneLight, settings: Partial<LightRangeView> = {}, factor = 1) => {
  const { slot, view } = held(light, settings, factor)
  return lightDrawn(slot, view)
}
/** A lane of the draw range of the light's slot (`DRAW_SHARE`, `DRAW_FARTHEST`). */
const laneOf = (
  light: SceneLight,
  lane: 'drawShare' | 'maxDrawDistance',
  settings: Partial<LightRangeView> = {},
) => {
  const { lights, slot } = held(light, settings)
  return lights.draw[slot * DRAW_LANES + (lane === 'drawShare' ? DRAW_SHARE : DRAW_FARTHEST)]
}
const close = (actual: number, wanted: number) =>
  Math.abs(actual - wanted) < 1e-6 * Math.max(1, wanted)

test('a light of 1.5 m or less is left out past 50 m, a 1 m light at 60 m among them', () => {
  assert.equal(drawn(lamp(-60, 1)), false)
  assert.equal(drawn(lamp(-40, 1)), true)
  assert.ok(close(laneOf(lamp(0, 1.5), 'drawShare'), 0.02))
  assert.ok(close(laneOf(lamp(0, 0.2), 'drawShare'), 0.02), 'a small one the same')
})

test('a larger light is left out past its radius over the screen share: 33 times a 10 m radius', () => {
  assert.ok(close(laneOf(lamp(0, 10), 'drawShare'), 0.03 / 10))
  assert.equal(drawn(lamp(-300, 10)), true, '0.03 / 10 * 300 = 0.9')
  assert.equal(drawn(lamp(-340, 10)), false)
})

test('the screen share and the view’s factor move the edge; a share of 0 leaves none out', () => {
  assert.equal(drawn(lamp(-30, 1), {}, 2), false)
  assert.equal(drawn(lamp(-20, 1), {}, 2), true)
  assert.equal(drawn(lamp(-300, 10), { lightMinScreenRadius: 0.06 }), false)
  assert.equal(drawn(lamp(-1e6, 1), { lightMinScreenRadius: 0 }), true)
})

test('a draw distance leaves the light out past it, scaled; 0 is no limit', () => {
  assert.equal(drawn(lamp(-19, 1, { maxDrawDistance: 20 })), true)
  assert.equal(drawn(lamp(-21, 1, { maxDrawDistance: 20 })), false)
  assert.equal(drawn(lamp(-39, 1, { maxDrawDistance: 20 }), { lightMaxDrawDistanceScale: 2 }), true)
  assert.equal(
    drawn(lamp(-41, 1, { maxDrawDistance: 20 }), { lightMaxDrawDistanceScale: 2 }),
    false,
  )
  // No limit of its own: a 10 m light at 300 m is kept by its size alone.
  assert.equal(drawn(lamp(-300, 10, { maxDrawDistance: 0 })), true)
  assert.equal(drawn(lamp(-300, 10)), true)
  // A scale of 0 leaves a light that names a distance out wherever it is, and one that names none where it was.
  assert.equal(drawn(lamp(-1, 1, { maxDrawDistance: 20 }), { lightMaxDrawDistanceScale: 0 }), false)
  assert.equal(drawn(lamp(-1, 1), { lightMaxDrawDistanceScale: 0 }), true)
})

test('a sun and an orthographic view leave out nothing', () => {
  const sun: SceneLight = { ...lamp(-1e6, 1), kind: 'directional', direction: [0, -1, 0] }
  delete sun.position
  delete sun.range
  assert.equal(drawn(sun), true)
  assert.equal(laneOf(sun, 'drawShare'), 0, 'no share, no distance')
  assert.equal(laneOf(sun, 'maxDrawDistance'), 0)
  const { slot } = held(lamp(-1e6, 1, { maxDrawDistance: 1 }))
  assert.equal(lightDrawn(slot), true, 'no view: orthographic')
})

test('a view’s factor is its horizontal field of view over 90 degrees, 1 where the setting is off; an orthographic view has none', () => {
  const lights = createSceneLightStore()
  const camera = (degrees: number, aspect = 1) => ({
    perspective: 1 as const,
    fov: degrees,
    aspect,
    eye,
  })
  const follows = { lightDrawRangeFollowsFieldOfView: true }
  assert.ok(close(lightDrawViewOf(camera(90), lights, follows)!.factor, 1))
  assert.ok(close(lightDrawViewOf(camera(60), lights, follows)!.factor, 60 / 90))
  const wide = lightDrawViewOf(camera(60, 2), lights, follows)!.factor
  assert.ok(
    close(wide, (2 * Math.atan(Math.tan(30 * (Math.PI / 180)) * 2)) / (Math.PI / 2)),
    'the aspect widens the horizontal field',
  )
  assert.equal(
    lightDrawViewOf(camera(60), lights, { lightDrawRangeFollowsFieldOfView: false })!.factor,
    1,
  )
  assert.equal(
    lightDrawViewOf({ ...camera(60), perspective: 0 as never }, lights, follows),
    undefined,
  )
})

test('the rule on the squared distance, as the reference decides it: NaN, a radius of 0, a setting of 0, a scale of 0', () => {
  // A distance no comparison orders is left out, as a NaN fails the reference's first test.
  assert.equal(inDrawRange(NaN, 0.02, 0, 1), false)
  assert.equal(inDrawRange(NaN, 0.02, 20, 1), false)
  // A radius of 0 is the share 0.02 (the contract refuses a light of no range: a hair of one is the same): left out past 50 m.
  assert.equal(drawShareOf(0, SETTINGS), 0.02)
  assert.equal(laneOf(lamp(0, 1e-9), 'drawShare'), Math.fround(0.02))
  assert.equal(drawn(lamp(-49, 1e-9)), true)
  assert.equal(drawn(lamp(-51, 1e-9)), false)
  // The setting 0 leaves no light out by its size, whatever the distance.
  assert.equal(laneOf(lamp(0, 5), 'drawShare', { lightMinScreenRadius: 0 }), 0)
  assert.equal(inDrawRange(1e30, 0, 0, 1), true)
  // The scale 0 leaves a light that names a distance out everywhere, the eye's own place included, and one that names none where it was.
  assert.equal(
    drawn(lamp(0, 1, { maxDrawDistance: 20 }), { lightMaxDrawDistanceScale: 0 }),
    false,
    'at the eye',
  )
  assert.equal(drawn(lamp(0, 1), { lightMaxDrawDistanceScale: 0 }), true)
  // The edge is strict: a light at its greatest distance is out, one a hair short of it in.
  assert.equal(inDrawRange(400, 0, 20, 1), false)
  assert.equal(inDrawRange(399.99, 0, 20, 1), true)
})

test('a light the view leaves out is marked in its kind word, the words that changed go up, and a view that did not move decides nothing', () => {
  const fake = fakeDevice()
  const store = createSceneLightStore()
  store.setRangeView(SETTINGS)
  const ids = [-10, -60, -70, -20].map((z, k) =>
    store.add({ ...lamp(z, 1), id: `l${k}`, castsShadow: false }),
  )
  const words = new Uint32Array(store.packed.buffer)
  const undrawn = (slot: number) =>
    (words[baseOf(slot) + LIGHT_FIELD.kind] >>> LIGHT_UNDRAWN_SHIFT) & 1
  const buffer = fake.device.createBuffer({
    size: LIGHT_BUFFER_AT.items + 64 * SCENE_LIGHT_FLOATS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const state = createDrawnLights()
  const view = { eye: [0, 0, 0], factor: 1, lights: store }
  assert.deepEqual(ids.map(undrawn), [0, 0, 0, 0], 'a light written anew is drawn')
  const epoch = store.epoch
  const written = words[baseOf(1) + LIGHT_FIELD.kind]
  assert.equal(drawLights(fake.device, buffer, store, state, view), true)
  assert.deepEqual(ids.map(undrawn), [0, 1, 1, 0], 'the 1 m lights past 50 m are left out')
  assert.equal(store.epoch, epoch, 'the decision is no change of the lights')
  // Slots 1 and 2 are neighbours: one write of their two records.
  assert.deepEqual(
    fake.writes.map(({ offset, data }) => [offset, (data as ArrayLike<number>).length]),
    [[LIGHT_BUFFER_AT.items + 1 * SCENE_LIGHT_FLOATS * 4, 2 * SCENE_LIGHT_FLOATS]],
  )
  fake.writes.length = 0
  assert.equal(
    drawLights(fake.device, buffer, store, state, view),
    false,
    'the same view, the same lights: nothing is decided',
  )
  assert.deepEqual(fake.writes, [])
  // The eye moves 30 m toward them: every light is in range again, and the two that were out are the two records sent.
  assert.equal(drawLights(fake.device, buffer, store, state, { ...view, eye: [0, 0, -30] }), true)
  assert.deepEqual(ids.map(undrawn), [0, 0, 0, 0])
  assert.deepEqual(
    fake.writes.map(({ offset, data }) => [offset, (data as ArrayLike<number>).length]),
    [[LIGHT_BUFFER_AT.items + 1 * SCENE_LIGHT_FLOATS * 4, 2 * SCENE_LIGHT_FLOATS]],
  )
  // An orthographic view draws them all.
  assert.equal(drawLights(fake.device, buffer, store, state, undefined), true)
  assert.deepEqual(ids.map(undrawn), [0, 0, 0, 0])
  assert.equal(
    words[baseOf(1) + LIGHT_FIELD.kind],
    written,
    'the other parts of the word, the marker included, were never touched',
  )
  assert.equal(
    drawLights(fake.device, undefined, store, createDrawnLights(), { ...view, eye: [0, 0, 50] }),
    true,
  )
  assert.deepEqual(
    ids.map(undrawn),
    [1, 1, 1, 1],
    'with no buffer yet the table alone holds the decision',
  )
})

const DEG = Math.PI / 180
const spot = (z: number, direction: [number, number, number], degrees: number): SceneLight => ({
  ...lamp(z, 10),
  kind: 'spot',
  direction,
  outerConeAngle: degrees * DEG,
})
const near = (actual: number, wanted: number) => Math.abs(actual - wanted) < 1e-9

test('a point and a rectangle are measured by the ball of their range', () => {
  const rect: SceneLight = { ...lamp(-5, 7), kind: 'rect', direction: [0, 0, 1] }
  for (const light of [lamp(-5, 7), rect]) assert.ok(close(laneOf(light, 'drawShare'), 0.03 / 7))
})

test('a spot under 45 degrees is the sphere through its apex and its base rim', () => {
  const radius = 10 / (2 * Math.cos(30 * DEG))
  assert.ok(near(coneSphereRadius(10, Math.cos(30 * DEG)), radius))
  assert.ok(
    near(coneSphereAlong(10, Math.cos(30 * DEG)), radius),
    'centred a radius along the axis',
  )
  assert.ok(close(laneOf(spot(-100, [0, 0, 1], 30), 'drawShare'), 0.03 / radius))
})

test('a spot over 45 degrees is the sphere through its base circle', () => {
  const radius = coneSphereRadius(10, Math.cos(60 * DEG))
  assert.ok(near(radius, 10 * Math.sin(60 * DEG)))
  assert.ok(
    near(coneSphereAlong(10, Math.cos(60 * DEG)), 10 * Math.cos(60 * DEG)),
    'centred range * cos along the axis',
  )
  assert.ok(close(laneOf(spot(-100, [0, 0, 1], 60), 'drawShare'), 0.03 / radius))
})

test('a spot is left out from the centre of its cone sphere, not from its position', () => {
  // 30 degrees: the radius 5.77 m, the distance 192.45 m, the centre 5.77 m along the axis.
  assert.equal(drawn(spot(-195, [0, 0, 1], 30)), true, 'axis toward the eye: 189.2 m')
  assert.equal(drawn(spot(-190, [0, 0, -1], 30)), false, 'axis away: 195.8 m')
  // 60 degrees: the radius 8.66 m, the distance 288.7 m, the centre 5 m along the axis.
  assert.equal(drawn(spot(-290, [0, 0, 1], 60)), true, 'axis toward the eye: 285 m')
  assert.equal(drawn(spot(-286, [0, 0, -1], 60)), false, 'axis away: 291 m')
})

test('the shadow plan keeps a light the view leaves out from its maps', () => {
  const identity = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  const planes = vsmSeenPlanes(
    new Float64Array(24),
    identity,
    perspectiveProjection(new Float64Array(16), 90, 1, 0.1, 1),
    1000,
    1000,
  )
  const far = held(lamp(-60, 1))
  assert.equal(vsmLightSeen(lamp(-60, 1), far.slot, planes), true, 'in the frustum')
  assert.equal(vsmLightSeen(lamp(-60, 1), far.slot, planes, far.view), false, 'too small at 60 m')
  const near40 = held(lamp(-40, 1))
  assert.equal(vsmLightSeen(lamp(-40, 1), near40.slot, planes, near40.view), true)
})
