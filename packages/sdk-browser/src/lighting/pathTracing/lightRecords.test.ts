// The lights of an image in the records the path tracer reads, made from the light store's table.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSceneLightStore } from '../../../../sdk-core/src/scene/light/store.ts'
import type { SceneLight } from '../../../../sdk-core/src/scene/light/contracts.ts'
import { brightnessOf } from '../../../../sdk-core/src/scene/light/fields.ts'
import { buildPathTracingLights, PT_LIGHT, PT_LIGHT_AT, PT_LIGHT_FLOATS } from './lightRecords.ts'

const sun: SceneLight = {
  id: 'sun',
  kind: 'directional',
  direction: [0, -1, 0],
  color: [1, 0.9, 0.8],
  intensity: 3,
  castsShadow: true,
}
const lamp: SceneLight = {
  id: 'lamp',
  kind: 'point',
  position: [4, 5, 6],
  color: [1, 0.5, 0.25],
  intensity: 2,
  range: 10,
  castsShadow: false,
  emitterRadius: 0.25,
}
const spot: SceneLight = {
  id: 'spot',
  kind: 'spot',
  position: [0, 3, 0],
  direction: [0, -1, 0],
  color: [1, 1, 1],
  intensity: 1,
  range: 8,
  innerConeAngle: 0.2,
  outerConeAngle: 0.5,
  castsShadow: true,
}
const rect: SceneLight = {
  id: 'rect',
  kind: 'rect',
  position: [0, 0, 5],
  direction: [0, 0, -1],
  right: [1, 0, 0],
  size: [2, 1],
  color: [1, 1, 1],
  intensity: 1,
  range: 20,
  castsShadow: false,
}

function made(lights: SceneLight[], eye: [number, number, number] = [0, 0, 0], sky = false) {
  const store = createSceneLightStore()
  for (const light of lights) store.add({ ...light })
  return { store, built: buildPathTracingLights(store, eye, sky) }
}
const at = (built: ReturnType<typeof made>['built'], index: number, field: number) =>
  built.data[index * PT_LIGHT_FLOATS + field]!

test('the sky comes first when there is one, then the suns, then the lamps and rectangles', () => {
  const { built } = made([lamp, sun, rect, spot], [0, 0, 0], true)
  assert.equal(built.count, 5)
  assert.equal(built.infinite, 2)
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((i) => at(built, i, PT_LIGHT_AT.kind)),
    [PT_LIGHT.sky, PT_LIGHT.directional, PT_LIGHT.point, PT_LIGHT.rect, PT_LIGHT.spot],
  )
})

test('a sun is the direction toward it, its irradiance and the sine of its disk', () => {
  const { store, built } = made([sun])
  assert.deepEqual(
    [0, 1, 2].map((c) => at(built, 0, PT_LIGHT_AT.axis + c) + 0),
    [0, 1, 0],
  )
  const strength = brightnessOf(store.light('sun')!)
  assert.ok(Math.abs(at(built, 0, PT_LIGHT_AT.colour) - 1 * strength) < 1e-5)
  assert.ok(Math.abs(at(built, 0, PT_LIGHT_AT.colour + 1) - 0.9 * strength) < 1e-5)
  assert.ok(at(built, 0, PT_LIGHT_AT.radius) > 0)
  assert.equal(at(built, 0, PT_LIGHT_AT.shadow), 1)
})

test('a lamp is placed relative to the eye and bounds the box of the lamps by its range', () => {
  const { built } = made([lamp], [1, 1, 1])
  assert.deepEqual(
    [0, 1, 2].map((c) => at(built, 0, PT_LIGHT_AT.position + c)),
    [3, 4, 5],
  )
  assert.equal(at(built, 0, PT_LIGHT_AT.range), 10)
  assert.equal(at(built, 0, PT_LIGHT_AT.radius), 0.25)
  assert.equal(at(built, 0, PT_LIGHT_AT.shadow), 0)
  assert.deepEqual(built.boundMin, [-7, -6, -5])
  assert.deepEqual(built.boundMax, [13, 14, 15])
})

test('a spot carries the cosine of its outer cone and the reciprocal of the gap to the inner', () => {
  const { built } = made([spot])
  const outer = at(built, 0, PT_LIGHT_AT.cosOuter)
  assert.ok(Math.abs(outer - Math.cos(0.5)) < 1e-3)
  assert.ok(Math.abs(at(built, 0, PT_LIGHT_AT.invCone) - 1 / (Math.cos(0.2) - Math.cos(0.5))) < 1)
})

test('a rectangle carries its size, its normal and a height axis across both its normal and its width', () => {
  const { built } = made([rect])
  assert.equal(at(built, 0, PT_LIGHT_AT.width), 2)
  assert.equal(at(built, 0, PT_LIGHT_AT.height), 1)
  assert.deepEqual(
    [0, 1, 2].map((c) => at(built, 0, PT_LIGHT_AT.axis + c)),
    [0, 0, -1],
  )
  const tangent = [0, 1, 2].map((c) => at(built, 0, PT_LIGHT_AT.tangent + c))
  assert.ok(Math.abs(Math.hypot(...tangent) - 1) < 1e-6)
  assert.ok(Math.abs(tangent[0]!) < 1e-6 && Math.abs(tangent[2]!) < 1e-6)
})

test('without a lamp the box is empty, so that no point falls in the grid', () => {
  const { built } = made([sun])
  assert.ok(built.boundMin[0]! > built.boundMax[0]!)
})

test('a light the view leaves out is left out', () => {
  const store = createSceneLightStore()
  store.add({ ...lamp })
  store.add({ ...spot })
  store.assignDrawn(store.slotOf('lamp'), false)
  const built = buildPathTracingLights(store, [0, 0, 0], false)
  assert.equal(built.count, 1)
  assert.equal(built.data[PT_LIGHT_AT.kind], PT_LIGHT.spot)
})
