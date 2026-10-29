// The grooms out of the camera's view that a light still casts from: a local light reaches a groom its range
// (and a spot's cone) holds, a sun one whose bounds, extended along its direction, meet the view.
import test from 'node:test'
import assert from 'node:assert/strict'
import { boxSphereOf } from './boxSphere.ts'
import {
  createHairShadowPlan,
  hairReachedByLight,
  hairShadowPlan,
  type HairShadowInputs,
  type HairShadowLight,
} from './shadowCasters.ts'

/** The planes of a view that holds x and z within 10 and y within 1 of the origin, facing in. */
const VIEW = Float64Array.from([
  1, 0, 0, 10, -1, 0, 0, 10, 0, 1, 0, 1, 0, -1, 0, 1, 0, 0, 1, 10, 0, 0, -1, 10,
])
/** A groom one metre tall, five metres over the view. */
const GROOM = boxSphereOf([-0.5, 5, -0.5, 0.5, 6, 0.5])

const lit = (shadow: HairShadowInputs) =>
  hairReachedByLight(GROOM, hairShadowPlan(createHairShadowPlan(), shadow, VIEW))

const sunAlong = (direction: [number, number, number]): HairShadowLight => ({
  kind: 'directional',
  direction,
})

test('a sun reaches a groom whose bounds, extended along its direction, meet the view', () => {
  // Straight down, the groom's box runs from 5 to 6 over the view: 4 metres short of the view at 2 metres a
  // side, in reach at 20.
  assert.equal(lit({ lights: [sunAlong([0, -1, 0])], distance: 2 }), false)
  assert.equal(lit({ lights: [sunAlong([0, -1, 0])], distance: 20 }), true)
  // A sun across the view never brings a groom that is over it in.
  assert.equal(lit({ lights: [sunAlong([1, 0, 0])], distance: 2 }), false)
  // The direction need not be a unit one, nor run along the up axis.
  assert.equal(lit({ lights: [sunAlong([0, -3, 3])], distance: 20 }), true)
})

test('a point light reaches a groom its range holds, a spot light one its cone holds as well', () => {
  const point = (y: number, range: number): HairShadowLight => ({
    kind: 'point',
    position: [0, y, 0],
    range,
  })
  assert.equal(lit({ lights: [point(5.5, 1)], distance: 20 }), true)
  assert.equal(lit({ lights: [point(20, 5)], distance: 20 }), false)
  const spot = (direction: [number, number, number]): HairShadowLight => ({
    kind: 'spot',
    position: [0, 10, 0],
    range: 10,
    direction,
    outerConeAngle: 0.2,
  })
  assert.equal(lit({ lights: [spot([0, -1, 0])], distance: 20 }), true)
  assert.equal(lit({ lights: [spot([0, 1, 0])], distance: 20 }), false)
  assert.equal(lit({ lights: [], distance: 20 }), false, 'with no light, none is reached')
})

test('the plan of an image serves every groom of it: two lights, one plan', () => {
  const plan = hairShadowPlan(
    createHairShadowPlan(),
    {
      lights: [sunAlong([0, -1, 0]), { kind: 'point', position: [30, 0, 0], range: 1 }],
      distance: 20,
    },
    VIEW,
  )
  assert.equal(hairReachedByLight(GROOM, plan), true, 'the sun reaches the groom over the view')
  const far = boxSphereOf([-0.5, 50, -0.5, 0.5, 51, 0.5])
  assert.equal(hairReachedByLight(far, plan), false, 'neither light reaches a groom far above')
})
