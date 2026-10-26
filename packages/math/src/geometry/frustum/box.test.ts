// box.ts: box against viewing frustum — inside, outside, straddling, and a box intersecting the
// near plane — with the verdicts read off the camera's geometry.
import test from 'node:test'
import assert from 'node:assert/strict'
import { clipPlanesFromMatrix, frustumPlanesFromMatrix } from './frustum.ts'
import { frustumClipBox, frustumExcludesBox } from './box.ts'
import { perspectiveProjection } from '../../projection/camera.ts'

/** The view-projection of a perspective camera at z = 10 looking at the origin (field 50, ratio
 *  1.3, near 0.5): the engine's own projection, then the view's move of -10 along z. */
function camera() {
  const m = perspectiveProjection(new Float64Array(16), 50, 1.3, 0.5, 1)
  m[14] = 0.5 // clip z stays the near distance: the view moves points along z only
  m[15] = 10 // clip w = 10 - z, the distance ahead of the eye
  return m
}
const vp = camera()
const planes = new Float64Array(24)
frustumPlanesFromMatrix(planes, vp)
const raw = new Float64Array(24)
clipPlanesFromMatrix(raw, vp)

type Bounds = [number, number, number, number, number, number]

// Camera is at z = 10, looking at origin: near plane (near = 0.5) cuts world at
// z = 9.5, inside of frustum is on z < 9.5 side.
test('box entirely inside, in front of near plane, yields 2 and is not excluded', () => {
  const b: Bounds = [-0.15, -0.15, 9.0, 0.15, 0.15, 9.3]
  assert.equal(frustumClipBox(planes, ...b), 2)
  assert.equal(frustumExcludesBox(planes, ...b), false)
})

test('box entirely outside, far to the side, yields 0 and is excluded', () => {
  const b: Bounds = [500, 500, 500, 501, 501, 501]
  assert.equal(frustumClipBox(planes, ...b), 0)
  assert.equal(frustumExcludesBox(planes, ...b), true)
})

test('box straddling left plane, far from near plane, yields 1 and is not excluded', () => {
  const b: Bounds = [5, -0.5, -1, 7, 0.5, 1]
  assert.equal(frustumClipBox(planes, ...b), 1)
  assert.equal(frustumExcludesBox(planes, ...b), false)
})

test('box intersecting near plane (z = 9.5) yields 1, never 0 nor 2', () => {
  const b: Bounds = [-0.3, -0.3, 9.3, 0.3, 0.3, 9.7]
  assert.equal(frustumClipBox(planes, ...b), 1)
  assert.equal(frustumExcludesBox(planes, ...b), false)
})

test('verdict is identical with raw (unnormalized) planes and normalized planes', () => {
  const boxes: Bounds[] = [
    [-0.15, -0.15, 9.0, 0.15, 0.15, 9.3],
    [500, 500, 500, 501, 501, 501],
    [5, -0.5, -1, 7, 0.5, 1],
    [-0.3, -0.3, 9.3, 0.3, 0.3, 9.7],
  ]
  for (const b of boxes) {
    assert.equal(frustumClipBox(raw, ...b), frustumClipBox(planes, ...b))
    assert.equal(frustumExcludesBox(raw, ...b), frustumExcludesBox(planes, ...b))
  }
})

test('hostile box (NaN or inverted bounds) never rejects: comparison with NaN always fails', () => {
  assert.equal(frustumExcludesBox(planes, NaN, 0, 9, 0, 0, 10), false)
  assert.equal(frustumExcludesBox(planes, 1, 1, 1, -1, -1, -1), false) // inverted
})
