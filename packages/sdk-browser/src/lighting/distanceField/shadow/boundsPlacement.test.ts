// The suns' mesh lists: the radii, the snap, the shadow space's origin and depth.

import test from 'node:test'
import assert from 'node:assert/strict'
import { DFSH_PARAMS, shadowTileSide } from './layout.ts'
import { snapTexelsOf, tilesOf } from './params.ts'
import { SETTINGS, SUN, dot, near, placed } from './boundsParams.fixture.ts'

test('the two radii: the sphere’s own for the grid of tiles, that rounded up to a centimetre for the space', () => {
  const { bounds } = placed([0, 0, 0])
  assert.ok(bounds.radius !== bounds.roundedRadius, 'the sphere’s radius is no whole centimetre')
  assert.equal(bounds.roundedRadius, Math.ceil(bounds.radius))
  assert.equal(tilesOf(bounds, SETTINGS), shadowTileSide(bounds.radius, 200))
})

test('the snap resolution is held between 32 and the device’s limit, less the border of each side', () => {
  assert.equal(snapTexelsOf(2048, 16384), 2040)
  assert.equal(snapTexelsOf(4096, 2048), 2040)
  assert.equal(snapTexelsOf(1, 16384), 24)
})

test('the origin of the shadow space stays on a grid fixed in the world as the camera moves', () => {
  const step = (2 * 4) / SETTINGS.snapTexels
  const at = DFSH_PARAMS.at.toShadow
  for (const eye of [
    [0, 0, 0],
    [3.3, 0, 0],
    [3.3, 0, 7.1],
    [-1000.5, 20, 5000.25],
  ]) {
    const { bounds, floats } = placed(eye)
    for (const [axis, row] of [
      [bounds.right, 0],
      [bounds.up, 1],
    ] as const) {
      const origin = -floats[at + 12 + row] * bounds.roundedRadius
      const steps = (dot(axis, eye) * 100 + origin) / bounds.roundedRadius / step
      near(steps, Math.round(steps), `a whole number of steps at ${eye}`, 1e-4)
    }
  }
})

test('the depth of the shadow space reaches 5000 centimetres either side of its origin at least', () => {
  const { bounds, floats } = placed([0, 0, 0], SUN, SETTINGS, 0.5)
  assert.ok(bounds.roundedRadius < 5000, `${bounds.roundedRadius}`)
  const at = DFSH_PARAMS.at.toShadow
  const depthOf = (offset: number) => {
    const p = bounds.centre.map((x, k) => x + SUN[k] * offset)
    return [0, 1, 2].reduce((sum, k) => sum + floats[at + k * 4 + 2] * p[k], 0) + floats[at + 14]
  }
  near(depthOf(0), 0.5, 'the middle', 1e-5)
  near(depthOf(-5000), 0, 'the far end', 1e-5)
  near(depthOf(5000), 1, 'the near end', 1e-5)
  // A larger sphere sets its own range.
  const { bounds: large, floats: wide } = placed([0, 0, 0])
  const radius = large.roundedRadius
  assert.ok(radius > 5000)
  const top = large.centre.map((x, k) => x + SUN[k] * radius)
  const edge = [0, 1, 2].reduce((sum, k) => sum + wide[at + k * 4 + 2] * top[k], wide[at + 14])
  near(edge, 1, 'a radius toward the light', 1e-5)
})
