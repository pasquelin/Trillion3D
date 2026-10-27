// The screen rectangle a local light reaches (`perLightScissor.ts`): the image of the sphere of its range,
// the planes through the eye that touch it bounding it on each axis.
import test from 'node:test'
import assert from 'node:assert/strict'
import { projectedLightRect } from './perLightScissor.ts'
import { camera } from './projectionScene.fixture.ts'

const out = new Int32Array(8)
const WIDTH = 64
const HEIGHT = 32
const rectOf = (position: number[], radius: number, view = camera, perspective = true) =>
  projectedLightRect(
    out,
    4,
    position,
    radius,
    view.view,
    view.projection,
    perspective,
    WIDTH,
    HEIGHT,
  )
    ? [...out.subarray(4, 8)]
    : undefined

test('a sphere ahead of the eye reaches the pixels between the planes that touch it, a pixel wider on every side', () => {
  // Depth 5, radius 2: the planes lie at ±asin(2/5) about the axis, ±0.4364 in clip units on both axes,
  // the columns [18.03, 45.97] and the rows [9.02, 22.98] of the 64 × 32 target.
  assert.deepEqual(rectOf([0, 0, -5], 2), [17, 8, 47, 24])
})

test('an eye inside the sphere, or a plane that touches behind it, bounds nothing on its side', () => {
  assert.deepEqual(rectOf([0, 0, -1], 2), [0, 0, WIDTH, HEIGHT], 'the eye inside')
  // The sphere's near side is behind the eye plane: its left plane points backwards and bounds nothing.
  assert.deepEqual(rectOf([3, 0, 0], 2.5), [52, 0, WIDTH, HEIGHT])
  // The planes touch it beyond the view's edges (±53 degrees about the axis, tangents past ±1).
  assert.deepEqual(rectOf([0, 0, -2.5], 2), [0, 0, WIDTH, HEIGHT])
})

test('a sphere past the screen, or wholly behind the eye, reaches no pixel and writes nothing', () => {
  out.fill(-1)
  assert.equal(rectOf([100, 0, -5], 2), undefined, 'far to the right')
  assert.equal(rectOf([0, 0, 5], 2), undefined, 'behind')
  assert.deepEqual([...out], new Array(8).fill(-1))
})

test('an orthographic view bounds the sphere by its extent on each axis', () => {
  const ortho = {
    ...camera,
    projection: [0.1, 0, 0, 0, 0, 0.2, 0, 0, 0, 0, -0.01, 0, 0, 0, 0, 1],
  }
  assert.deepEqual(rectOf([0, 0, -5], 2, ortho, false), [24, 8, 40, 24])
})
