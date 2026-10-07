// camera.ts: pixels per unit at unit depth, the focal length in pixels, a pixel's footprint, the
// projection scale of a half field and back, the diagonal slope and a frustum corner's distance —
// against exact cameras and the expressions they replace.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  focalPixels,
  focalScale,
  frustumCornerDistance,
  halfAngleOfFocalScale,
  perspectiveDiagonalSlope,
  perspectiveProjection,
  perspectiveSlope,
  pixelFootprint,
  pixelScale,
} from './camera.ts'
import { length3 } from '../vector/vector.ts'
import { assertSameFloat32, HALTON_SWEEP, haltonSpan } from '../sequence/sweep.fixture.ts'

test('pixelScale, focalPixels, pixelFootprint on a camera whose half picture is 2 units at depth 1', () => {
  // Projection scales 0.5 across and −0.25 up (a mirrored picture): half widths 2 and 4 at unit
  // depth, on a 800 × 600 viewport: 200 and 75 pixels per unit.
  const p = new Float64Array(16)
  p[0] = 0.5
  p[5] = -0.25
  assert.deepEqual(pixelScale([0, 0], p, 800, 600), [200, 75])
  assert.deepEqual(pixelScale([0, 0], p), [0.25, 0.125])
  assert.equal(focalPixels(p, 800, 600), 200)
  assert.equal(focalPixels(p), 0.25)
  assert.equal(pixelFootprint(p, 600), 1 / 75)
  // Under a pixel high, the footprint of one pixel.
  assert.equal(pixelFootprint(p, 0.5), 8)
})

test('pixelScale, focalPixels and pixelFootprint are the bodies they replace, bit for bit', () => {
  const p = new Float64Array(16),
    out = [0, 0]
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    p[0] = haltonSpan(i, 2, -10, 10)
    p[5] = haltonSpan(i, 3, -10, 10)
    const width = haltonSpan(i, 5, 0, 8192),
      height = haltonSpan(i, 7, 0, 8192)
    const old = [(width * Math.abs(p[0])) / 2, (height * Math.abs(p[5])) / 2]
    pixelScale(out, p, width, height)
    assert.ok(Object.is(out[0], old[0]) && Object.is(out[1], old[1]), `scale ${i}`)
    assert.ok(Object.is(focalPixels(p, width, height), Math.max(old[0], old[1])), `focal ${i}`)
    const footprint = 1 / ((Math.max(1, height) * Math.abs(p[5])) / 2)
    assert.ok(Object.is(pixelFootprint(p, height), footprint), `footprint ${i}`)
  }
})

test('focalScale is the engine projection scale; halfAngleOfFocalScale inverts it, either sign', () => {
  // The engine's 90° projection: a scale of cot 45°.
  const p = perspectiveProjection(new Float64Array(16), 90, 1, 1, 1)
  assert.ok(Math.abs(focalScale(Math.PI / 4) - p[5]) <= Number.EPSILON)
  assert.ok(Math.abs(focalScale(Math.PI / 6) - Math.sqrt(3)) <= 2 * Number.EPSILON)
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const half = haltonSpan(i, 2, 1e-3, Math.PI / 2 - 1e-3),
      s = focalScale(half)
    assert.ok(Math.abs(halfAngleOfFocalScale(s) - half) <= 4 * Number.EPSILON, `${i}`)
    assert.equal(halfAngleOfFocalScale(-s), halfAngleOfFocalScale(s))
  }
})

test('perspectiveDiagonalSlope: the corner ray of a 90° square picture leans √2', () => {
  assert.ok(Math.abs(perspectiveDiagonalSlope(90, 1) - Math.SQRT2) <= 2 * Number.EPSILON)
  // A zoom of 2 halves it; an aspect of 0 leaves the vertical slope.
  assert.ok(Math.abs(perspectiveDiagonalSlope(90, 1, 2) - Math.SQRT1_2) <= Number.EPSILON)
  assert.equal(perspectiveDiagonalSlope(60, 0), perspectiveSlope(60))
  // The lens slope it replaces squares the aspect with `**`.
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const fov = haltonSpan(i, 2, 1, 179),
      aspect = haltonSpan(i, 3, 0.1, 10),
      zoom = haltonSpan(i, 5, 0.25, 8)
    const old = perspectiveSlope(fov, zoom) * Math.sqrt(1 + aspect ** 2)
    assert.ok(Object.is(perspectiveDiagonalSlope(fov, aspect, zoom), old), `${i}`)
  }
})

test('frustumCornerDistance: the length of the corner (s·a·d, s·d, d), and the old body', () => {
  // Depth 2, slope 3/4, aspect 4/3: the corner (2, 1.5, 2), of length √10.25.
  assert.ok(
    Math.abs(frustumCornerDistance(2, 0.75, 4 / 3) - Math.sqrt(10.25)) <= 4 * Number.EPSILON,
  )
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const depth = haltonSpan(i, 2, 0.1, 1e5),
      slope = haltonSpan(i, 3, 0.01, 10),
      aspect = haltonSpan(i, 5, 0.1, 10)
    const reference = length3(depth, depth * slope, depth * slope * aspect)
    const distance = frustumCornerDistance(depth, slope, aspect)
    assert.ok(Math.abs(distance - reference) <= 8 * Number.EPSILON * reference, `${i}`)
    assertSameFloat32(
      depth * Math.sqrt(1 + slope * slope * (1 + aspect * aspect)),
      distance,
      `${i}`,
    )
  }
})
