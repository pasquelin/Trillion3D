// A lamp no lit point of the frame is in reach of costs nothing: its sphere wholly behind
// one plane of the view one pixel wider, it takes no map, no page and no projection, its cache
// waiting unreferenced. A lamp whose sphere touches the view projects.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { SceneLight } from '../../../../../sdk-core/src/scene/light/contracts.ts'
import { perspectiveProjection } from '../../../../../math/src/projection/camera.ts'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createVsmResources } from './resources.ts'
import { LIGHT_KIND } from '../../../../../sdk-core/src/scene/light/contracts.ts'
import { spotConesOf } from '../../../../../sdk-core/src/scene/light/fields.ts'
import { VSM_MAP_UNSEEN } from './constants.ts'
import { createVsmFrameState } from './frameState.ts'
import { vsmCacheKey } from './lightCache.ts'
import { finishVirtualShadowFrame, planVirtualShadowFrame } from './frameSetup.ts'
import { vsmLightSeen, vsmSeenPlanes } from './seenLights.ts'
import { vsmLocalShadowGate, type VsmGateView } from './localGate.ts'
import { VSM_DEFAULT_SHADOWS } from './mapSettings.ts'

const WIDTH = 1000,
  HEIGHT = 1000
// The eye at the origin looking down −Z, 90° vertical field, square: the side planes are the
// diagonals x = ±z, y = ±z.
const view = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
const projection = perspectiveProjection(new Float64Array(16), 90, 1, 0.1, 1)
const planes = vsmSeenPlanes(new Float64Array(24), view, projection, WIDTH, HEIGHT)
const lamp = (position: [number, number, number], range: number): SceneLight => ({
  id: 'lamp',
  kind: 'point',
  position,
  range,
  color: [1, 1, 1],
  intensity: 1,
  castsShadow: true,
})

test('a lamp behind the eye is not seen; a sun always is', () => {
  assert.equal(vsmLightSeen(lamp([0, 0, 20], 5), planes), false)
  assert.equal(vsmLightSeen(lamp([0, 0, 2], 5), planes), true, 'its sphere holds the eye')
  const sun: SceneLight = { ...lamp([0, 0, 20], 1), kind: 'directional', direction: [0, -1, 0] }
  assert.equal(vsmLightSeen(sun, planes), true)
})

test('a sphere that touches the view one pixel wider is seen, one past it is not', () => {
  // At depth 10 the left plane x = −10 lies 10/√2 from a centre on x = −20, y = 0: a pixel wider
  // moves it by 10·(2/1000)/√2.
  const gap = 10 / Math.SQRT2,
    pixel = (10 * 0.002) / Math.SQRT2
  assert.equal(vsmLightSeen(lamp([-20, 0, -10], gap + pixel / 2), planes), true, 'in the pixel')
  assert.equal(vsmLightSeen(lamp([-20, 0, -10], gap + 2 * pixel), planes), true)
  assert.equal(vsmLightSeen(lamp([-20, 0, -10], gap - 2 * pixel), planes), false)
})

test('a lamp not visible takes no map and marks no page: its entry waits unreferenced', () => {
  const { device } = fakeDevice({ limits: { maxStorageBufferBindingSize: 1 << 27 } })
  const res = createVsmResources(device, { fullMapCapacity: 63, poolPages: 256 })
  const state = createVsmFrameState(device, res)
  const camera = { view, projection, eye: [0, 0, 0], perspective: true }
  const viewport = { width: WIDTH, height: HEIGHT }
  const seen = lamp([0, 0, -10], 5),
    behind = { ...lamp([0, 0, 20], 5), id: 'behind' }
  const plan = (visible: boolean) => {
    const frame = planVirtualShadowFrame(
      state,
      [{ light: seen }, { light: behind, visible }],
      camera,
      viewport,
    )
    finishVirtualShadowFrame(state, frame)
    return frame
  }
  const first = plan(true).lights
  assert.deepEqual(
    first.map((l) => l.id),
    ['lamp', 'behind'],
  )
  // The plan made a record a light every frame: now held, each rewritten whole.
  const held = first[1],
    again = plan(true).lights
  assert.equal(again[1], held, 'the same record')
  assert.deepEqual([held.id, !!held.local, held.clipmap], ['behind', true, undefined])
  const culled = plan(vsmLightSeen(behind, planes))
  assert.deepEqual(
    culled.lights.map((l) => l.id),
    ['lamp'],
    'only the seen lamp has maps',
  )
  const entry = [...state.cache.entries.values()].find((e) => e.lightId === 'behind')
  assert.ok(entry && entry.mapId >= 0, 'the culled lamp keeps its cache entry')
  assert.ok(
    entry.mapCaches.every((map) => map.projectionData.flags & VSM_MAP_UNSEEN),
    'flagged unreferenced: its coarse pages are not marked (vsmMarkCoarse)',
  )
})

test('a rectangle that casts takes the six faces of a point light’s cube, its rotation keying its cache', () => {
  const { device } = fakeDevice({ limits: { maxStorageBufferBindingSize: 1 << 27 } })
  const res = createVsmResources(device, { fullMapCapacity: 63, poolPages: 256 })
  const state = createVsmFrameState(device, res)
  const camera = { view, projection, eye: [0, 0, 0], perspective: true }
  const viewport = { width: WIDTH, height: HEIGHT }
  const panel: SceneLight = {
    ...lamp([0, 0, -10], 5),
    ...{ id: 'panel', kind: 'rect', direction: [0, 0, 1], right: [1, 0, 0], size: [2, 1] },
  }
  const point = { ...lamp([0, 0, -10], 5), id: 'point' }
  const plan = (light: SceneLight) => {
    const frame = planVirtualShadowFrame(state, [{ light }, { light: point }], camera, viewport)
    finishVirtualShadowFrame(state, frame)
    return frame.lights.find((l) => l.id === light.id)!
  }
  const first = plan(panel)
  assert.deepEqual([first.kind, first.count, !!first.local], ['rect', 6, true])
  const twin = state.cache.entries.get(vsmCacheKey('point'))!
  first.entry.mapCaches.forEach((map, face) => {
    const data = map.projectionData
    assert.deepEqual(
      data.shiftedToClip,
      twin.mapCaches[face].projectionData.shiftedToClip,
      `${face}`,
    )
    assert.equal(data.lightKind, LIGHT_KIND.rect)
    assert.equal(data.emitterSize, 0, 'a rectangle has no source radius')
  })
  assert.equal(twin.mapCaches[0].projectionData.lightKind, LIGHT_KIND.point)
  // A rectangle at rest keeps its pages (its frame is cached); turned, or rolled, it starts again
  // (drawn uncached), as a light whose transform changed does.
  assert.equal(plan(panel).entry.isUncached, false, 'at rest')
  assert.equal(plan({ ...panel, direction: [1, 0, 0], right: [0, 0, 1] }).entry.isUncached, true)
  assert.equal(plan({ ...panel, direction: [1, 0, 0], right: [0, 0, 1] }).entry.isUncached, false)
  assert.equal(
    plan({ ...panel, direction: [1, 0, 0], right: [0, 1, 0] }).entry.isUncached,
    true,
    'rolled',
  )
})

// The gates a local light's shadow passes (`vsmLocalShadowGate`): a 1000-pixel square view whose
// projection scales are 1, so a light's radius spans 500 pixels at a distance of its own length.
const GATE_VIEW: VsmGateView = { projection: projection, eye: [0, 0, 0], width: 1000, height: 1000 }
const gate = (light: SceneLight, changes: Partial<typeof VSM_DEFAULT_SHADOWS> = {}) =>
  vsmLocalShadowGate(light, GATE_VIEW, { ...VSM_DEFAULT_SHADOWS, ...changes })
const lampAt = (kind: 'point' | 'rect' | 'spot', distance: number, range = 1): SceneLight => ({
  ...lamp([0, 0, -distance], range),
  ...(kind === 'point' ? {} : { kind }),
  ...(kind === 'rect' ? { direction: [0, 0, 1], right: [1, 0, 0], size: [1, 1] } : {}),
  ...(kind === 'spot' ? { direction: [0, 0, -1], outerConeAngle: 0.6 } : {}),
})

test('the shadow fade: none at the least resolution, rising to the whole one by the exponent, read by the gate', () => {
  // A point light of range `range` at 10 m, a view whose radius spans 50 texels per metre of range
  // (texels per pixel 1): its resolution is 50 × range. The gate takes the shadow where the fade
  // passes 1/256: the share of the range, its first step taken off, to the exponent, which gives
  // the resolution it flips at.
  const taken = (resolution: number, changes: Partial<typeof VSM_DEFAULT_SHADOWS>) =>
    gate(lampAt('point', 10, resolution / 50), { shadowTexelsPerPixelPoint: 1, ...changes })
  for (const exponent of [0.25, 0.5, 1]) {
    const range = {
      shadowMinResolution: 32,
      shadowFadeResolution: 64,
      shadowFadeExponent: exponent,
    }
    const first = (1 / 32) ** exponent
    // fade(r) = 1/256  <=>  ((r - 32) / 32) ^ exponent = first + (1 - first) / 256.
    const flips = 32 + 32 * (first + (1 - first) / 256) ** (1 / exponent)
    assert.equal(taken(flips + 0.01, range), true, `${exponent}: just past`)
    assert.equal(taken(flips - 0.01, range), false, `${exponent}: just short`)
    assert.equal(taken(32, range), false, 'at the least resolution: none')
    assert.equal(taken(64.5, range), true, 'past the whole one: whole')
  }
  // A least resolution at or past the whole one leaves no range between: 0 or 1.
  const none = { shadowMinResolution: 35, shadowFadeResolution: 30 }
  assert.deepEqual([taken(40, none), taken(20, none)], [true, false])
})

test('a local light takes a shadow while its resolution on the screen is past the fade', () => {
  for (const kind of ['point', 'rect', 'spot'] as const) {
    assert.equal(gate(lampAt(kind, 5)), true, `${kind} near`)
    assert.equal(gate(lampAt(kind, 500)), false, `${kind} far`)
  }
  // A point light of range 1 at 20 m is 31.8 texels, a rectangle's as many; the spot's texels are
  // twice as many per pixel, though its bounds are the cone's end.
  assert.equal(gate(lampAt('point', 20)), false)
  assert.equal(gate(lampAt('point', 15)), true, '42.4 texels')
  assert.equal(gate(lampAt('point', 20), { shadowTexelsPerPixelPoint: 3 }), true, 'its own texels')
  assert.equal(gate(lampAt('rect', 20), { shadowTexelsPerPixelPoint: 3 }), false)
  assert.equal(gate(lampAt('rect', 20), { shadowTexelsPerPixelRect: 3 }), true)
  assert.equal(gate(lampAt('spot', 20), { shadowTexelsPerPixelSpot: 40 }), true)
  assert.equal(gate(lampAt('point', 15), { shadowMinResolution: 50 }), false)
  assert.equal(gate(lampAt('point', 20), { shadowMinResolution: 0, shadowFadeResolution: 0 }), true)
  const sun: SceneLight = { ...lamp([0, 0, 0], 1), kind: 'directional', direction: [0, -1, 0] }
  assert.equal(gate(sun, { shadowMinResolution: 1e6 }), true, 'a sun has none')
})

test('the point-light switches gate a point and a rectangle, never a spot', () => {
  for (const off of ['shadowPointLightShadows', 'shadowPointLightCubemaps'] as const) {
    assert.equal(gate(lampAt('point', 5), { [off]: false }), false, `${off} point`)
    assert.equal(gate(lampAt('rect', 5), { [off]: false }), false, `${off} rect`)
    assert.equal(gate(lampAt('spot', 5), { [off]: false }), true, `${off} spot`)
  }
})

test('a light’s own resolution scale: 0 takes the shadow away, a larger one keeps a far light', () => {
  const far = lampAt('point', 20)
  assert.equal(gate({ ...far, shadowResolutionScale: 2 }), true, '63.6 texels')
  assert.equal(gate({ ...lampAt('point', 5), shadowResolutionScale: 0 }), false)
  const near = { ...lampAt('point', 5), shadowResolutionScale: 0 }
  // Off, the zero scale only brings the resolution to 0, which the fade reads — unless it reads
  // the resolution before the scale.
  assert.equal(gate(near, { shadowResolutionScaleZeroDisables: false }), false)
  assert.equal(
    gate(near, { shadowResolutionScaleZeroDisables: false, shadowFadeUsesResolutionScale: false }),
    true,
  )
  // The most texels holds a raised resolution; a spot's map takes its border off it.
  assert.equal(
    gate({ ...lampAt('point', 5), shadowResolutionScale: 100 }, { shadowMaxResolution: 30 }),
    false,
  )
  assert.equal(
    gate({ ...lampAt('spot', 5), shadowResolutionScale: 100 }, { shadowMaxResolution: 39 }),
    false,
  )
  assert.equal(
    gate({ ...lampAt('spot', 5), shadowResolutionScale: 100 }, { shadowMaxResolution: 50 }),
    true,
  )
})

test('a cap under the border of a spot’s map holds its shadow to nothing, it does not lift the cap', () => {
  // A resolution cap of 4 texels leaves a spot's map (a 4-texel border each side) none, a point
  // light's cube 4: neither shadow is whole enough to be taken.
  for (const kind of ['spot', 'point'] as const)
    assert.equal(gate(lampAt(kind, 5), { shadowMaxResolution: 4 }), false, kind)
  assert.equal(gate(lampAt('spot', 5), { shadowMaxResolution: 2048 }), true, 'the default cap')
})

test('a spot’s map is as wide as the outer cone the lighting lights it by, whatever its inner cone', () => {
  const { device } = fakeDevice({ limits: { maxStorageBufferBindingSize: 1 << 27 } })
  const res = createVsmResources(device, { fullMapCapacity: 63, poolPages: 256 })
  const state = createVsmFrameState(device, res)
  const camera = { view, projection, eye: [0, 0, 0], perspective: true }
  const viewport = { width: WIDTH, height: HEIGHT }
  for (const outerConeAngle of [0.3, 0.7, 0.9, 1.1])
    for (const innerConeAngle of [undefined, 0.5 * outerConeAngle, outerConeAngle]) {
      const spot = {
        ...lampAt('spot', 10, 5),
        id: 'spot',
        outerConeAngle,
        innerConeAngle,
      } as SceneLight
      const frame = planVirtualShadowFrame(state, [{ light: spot }], camera, viewport)
      finishVirtualShadowFrame(state, frame)
      const scale = frame.lights[0].entry.mapCaches[0].projectionData.lightViewToClip[0]
      assert.equal(
        scale,
        Math.fround(1 / Math.tan(spotConesOf(spot)[1])),
        `${outerConeAngle} ${innerConeAngle}`,
      )
    }
})
