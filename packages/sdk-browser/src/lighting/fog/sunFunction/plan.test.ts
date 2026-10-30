// The numbers of the sun's light function for the fog: the texture's side from the volume's cells and the sun's facing, the sphere that
// bounds the view slice, and the view block.
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  frustumSliceSphere,
  SUN_FOG_VIEW_FLOATS,
  sunFogSide,
  writeSunFogView,
  type SunFogCamera,
} from './plan.ts'

const AXES = { right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, -1] } as const
const CAMERA: SunFogCamera = {
  eye: [0, 0, 0],
  ...AXES,
  scaleX: 1,
  scaleY: 1,
  offsetX: 0,
  offsetY: 0,
  perspective: true,
}
const GRID = [240, 135, 128] as const

test('the side is the cells along the axis the sun faces most, times the scale, cut up to a multiple of 32', () => {
  // Along the view's right: 240 cells times 2 is 480, a multiple of 32 already.
  assert.equal(sunFogSide(AXES, [1, 0, 0], GRID, 2, 16384), 480)
  // Along the depth: 128 slices times 2 is 256.
  assert.equal(sunFogSide(AXES, [0, 0, 1], GRID, 2, 16384), 256)
  // Slanted: the larger weight rules, 0.6 * 240 * 2 = 288 and 0.8 * 135 * 2 = 216, so 288.
  assert.equal(sunFogSide(AXES, [0.6, 0.8, 0], GRID, 2, 16384), 288)
  // The scale is whole-truncated then cut up: 240 * 1.01 = 242 gives 256.
  assert.equal(sunFogSide(AXES, [1, 0, 0], GRID, 1.01, 16384), 256)
})

test('the side past the device’s largest texture is that size, at least 32', () => {
  assert.equal(sunFogSide(AXES, [1, 0, 0], GRID, 2, 256), 256)
  assert.equal(sunFogSide(AXES, [1, 0, 0], GRID, 2, 16), 32)
})

test('a supersample that rounds the estimate down to nothing still gives a texture of 32', () => {
  assert.equal(sunFogSide(AXES, [1, 0, 0], GRID, 0.001, 16384), 32)
  assert.equal(sunFogSide(AXES, [0, 0, 0], GRID, 2, 16384), 32)
})

test('the sphere of a quarter-turn view from the eye to 100 metres is centred at 100 and 141 metres wide', () => {
  const { centre, radius } = frustumSliceSphere(CAMERA, 0, 100)
  assert.deepEqual(centre, [0, 0, -100])
  assert.ok(Math.abs(radius - 100 * Math.SQRT2) < 1e-9)
})

test('a slice that starts away from the eye is bounded by its own corners and the radius is at least 1', () => {
  const slice = frustumSliceSphere(CAMERA, 50, 100)
  // The centre keeps within the slice, the sphere holds the far corners.
  assert.ok(slice.centre[2] <= -50 && slice.centre[2] >= -100)
  const corner = [100, 100, -100]
  assert.ok(Math.hypot(...corner.map((c, i) => c - slice.centre[i]!)) <= slice.radius + 1e-9)
  assert.equal(frustumSliceSphere({ ...CAMERA, scaleX: 1e6, scaleY: 1e6 }, 0, 0.001).radius, 1)
})

test('an orthographic view is a box as wide as its projection says, centred in its middle', () => {
  const box = frustumSliceSphere({ ...CAMERA, perspective: false, scaleX: 0.5, scaleY: 1 }, 0, 10)
  // Half extents 2 across and 1 up, 5 half the length.
  assert.deepEqual(box.centre, [0, 0, -5])
  assert.ok(Math.abs(box.radius - Math.hypot(2, 1, 5)) < 1e-9)
  // The projection's translation moves the box: an offset of 1 half extent leaves the field to the left of the axis.
  const moved = frustumSliceSphere(
    { ...CAMERA, perspective: false, scaleX: 0.5, scaleY: 1, offsetX: 1, offsetY: -0.5 },
    0,
    10,
  )
  assert.deepEqual(moved.centre, [-2, 0.5, -5])
  assert.equal(moved.radius, box.radius)
})

test('the slice of an asymmetric perspective view reaches its shifted corners', () => {
  const shifted = frustumSliceSphere({ ...CAMERA, offsetX: 0.5 }, 0, 100)
  const corner = [-100 * 1.5, 100, -100]
  assert.ok(Math.hypot(...corner.map((c, i) => c - shifted.centre[i]!)) <= shifted.radius + 1e-9)
})

test('the view block holds the sphere, the axes, the side, whether it is drawn, the eye and the fade', () => {
  const out = new Float32Array(SUN_FOG_VIEW_FLOATS)
  writeSunFogView(
    out,
    { centre: [1, 2, 3], radius: 4 },
    { right: [0, 1, 0], up: [0, 0, 1] },
    480,
    true,
    [7, 8, 9],
    {
      distance: 50,
      disabled: 0.25,
    },
  )
  assert.deepEqual([...out], [1, 2, 3, 4, 0, 1, 0, 480, 0, 0, 1, 1, 7, 8, 9, 0, 50, 0.25, 0, 0])
})
