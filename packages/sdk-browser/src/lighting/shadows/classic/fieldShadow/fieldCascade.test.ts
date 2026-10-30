// The sun's distance-field cascade on the classic shadows: where it lies, how it fades, and the bounds of its slice.

import test from 'node:test'
import assert from 'node:assert/strict'
import { sliceBounds } from '../../../distanceField/shadow/bounds.ts'
import {
  DEFAULT_SUN_CASCADES,
  cascadeDistance,
  cascadeRange,
  cascadeSphere,
  type ViewCascadeSettings,
} from '../cascadeSplits.ts'
import { fieldCascade } from './fieldCascade.ts'

const VIEW: ViewCascadeSettings = {
  distanceScale: 1,
  maxCascades: 10,
  transitionScale: 1,
  near: 10,
}
const TAN: [number, number] = [1.2, 0.7]
const input = (reach: number, farTransitionScale = 1) => ({
  sun: DEFAULT_SUN_CASCADES,
  view: VIEW,
  reach,
  farTransitionScale,
  tan: TAN,
})

test('the cascade begins where the last shadow-mapped cascade ends and ends at the reach', () => {
  const cascade = fieldCascade(input(51200))!
  assert.equal(cascade.near, cascadeDistance(DEFAULT_SUN_CASCADES, VIEW))
  assert.equal(cascade.far, 51200)
})

test('a reach short of the last cascade, or none, gives no cascade', () => {
  assert.equal(fieldCascade(input(cascadeDistance(DEFAULT_SUN_CASCADES, VIEW))), undefined)
  assert.equal(fieldCascade(input(0)), undefined)
})

test('with no shadow-mapped cascade it begins at the view’s near plane and fades in over nothing', () => {
  const none = { ...DEFAULT_SUN_CASCADES, cascades: 0 }
  const cascade = fieldCascade({ ...input(20000), sun: none })!
  assert.equal(cascade.near, VIEW.near)
  assert.equal(cascade.nearFadeLength, 0)
})

test('it fades to nothing over a share of its length, by moving its fade plane in; its range does not grow', () => {
  const cascade = fieldCascade(input(51200))!
  const share = DEFAULT_SUN_CASCADES.transitionFraction
  assert.ok(Math.abs(cascade.fadeLength - (51200 - cascade.near) * share) < 1e-6)
  assert.ok(Math.abs(cascade.fadePlane - (51200 - cascade.fadeLength)) < 1e-6)
  assert.equal(
    fieldCascade(input(51200, 0))!.fadeLength,
    0,
    'the far transition scale 0 cuts it sharp',
  )
  assert.ok(Math.abs(fieldCascade(input(51200, 0.5))!.fadeLength - cascade.fadeLength / 2) < 1e-6)
})

test('it fades in over the last shadow-mapped cascade’s fade length', () => {
  const count = DEFAULT_SUN_CASCADES.cascades
  const last = cascadeRange(DEFAULT_SUN_CASCADES, VIEW, count - 1)
  const cascade = fieldCascade(input(51200))!
  const share = DEFAULT_SUN_CASCADES.transitionFraction
  assert.ok(Math.abs(cascade.nearFadeLength - (last.far - last.near) * share) < 1e-6)
})

test('the bounds of a slice: a sphere that holds its corners, and the planes that bound it from the sun', () => {
  const sphere = cascadeSphere(100, 500, TAN[0], TAN[1])
  const slice = {
    forward: [0, 0, -1],
    right: [1, 0, 0],
    up: [0, 1, 0],
    tan: TAN,
    near: 100,
    far: 500,
    centre: sphere.depth,
    radius: sphere.radius,
  }
  const toLight = [0.3, 0.8, 0.52]
  const bounds = sliceBounds(slice, toLight)
  assert.equal(bounds.radius, sphere.radius * 100)
  assert.ok(bounds.planeCount >= 3 && bounds.planeCount <= 12)
  // The far corner farthest from the sphere’s centre lies within its radius.
  const corner = [500 * TAN[0], 500 * TAN[1], -500]
  const from = Math.hypot(corner[0], corner[1], corner[2] + sphere.depth)
  assert.ok(from <= sphere.radius + 1e-6)
  // No plane has the sun’s own corner outside: a point in the slice is inside every plane.
  const inside = [0, 0, -300]
  for (let k = 0; k < bounds.planeCount; k++) {
    const d =
      bounds.planes[4 * k]! * inside[0] * 100 +
      bounds.planes[4 * k + 1]! * inside[1] * 100 +
      bounds.planes[4 * k + 2]! * inside[2] * 100 -
      bounds.planes[4 * k + 3]!
    assert.ok(d <= 1e-3, `plane ${k} holds the slice’s middle`)
  }
})
