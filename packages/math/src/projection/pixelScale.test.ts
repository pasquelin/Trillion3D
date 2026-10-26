// camera.ts: pixels per unit at unit depth, the focal length in pixels, a pixel's footprint, the
// projection scale of a half field, and the diagonal slope —
// against exact cameras and the expressions they replace.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  focalPixels,
  focalScale,
  perspectiveDiagonalSlope,
  perspectiveProjection,
  perspectiveSlope,
  pixelScale,
} from './camera.ts'

test('pixelScale and focalPixels on a camera whose half picture is 2 units at depth 1', () => {
  // Projection scales 0.5 across and −0.25 up (a mirrored picture): half widths 2 and 4 at unit
  // depth, on a 800 × 600 viewport: 200 and 75 pixels per unit.
  const p = new Float64Array(16)
  p[0] = 0.5
  p[5] = -0.25
  assert.deepEqual(pixelScale([0, 0], p, 800, 600), [200, 75])
  assert.deepEqual(pixelScale([0, 0], p), [0.25, 0.125])
  assert.equal(focalPixels(p, 800, 600), 200)
  assert.equal(focalPixels(p), 0.25)
})

test('focalScale is the engine projection scale', () => {
  // The engine's 90° projection: a scale of cot 45°.
  const p = perspectiveProjection(new Float64Array(16), 90, 1, 1, 1)
  assert.ok(Math.abs(focalScale(Math.PI / 4) - p[5]) <= Number.EPSILON)
  assert.ok(Math.abs(focalScale(Math.PI / 6) - Math.sqrt(3)) <= 2 * Number.EPSILON)
})

test('perspectiveDiagonalSlope: the corner ray of a 90° square picture leans √2', () => {
  assert.ok(Math.abs(perspectiveDiagonalSlope(90, 1) - Math.SQRT2) <= 2 * Number.EPSILON)
  // A zoom of 2 halves it; an aspect of 0 leaves the vertical slope.
  assert.ok(Math.abs(perspectiveDiagonalSlope(90, 1, 2) - Math.SQRT1_2) <= Number.EPSILON)
  assert.equal(perspectiveDiagonalSlope(60, 0), perspectiveSlope(60))
})
