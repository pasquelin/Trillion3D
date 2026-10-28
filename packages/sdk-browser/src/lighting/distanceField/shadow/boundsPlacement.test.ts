// The sun's distance-field shadow: the radii, the snap, the shadow space's origin and depth, the trace
// size and the final pass's lanes.

import test from 'node:test'
import assert from 'node:assert/strict'
import { DFSH_FINAL, DFSH_PARAMS, shadowTileSide } from './layout.ts'
import {
  boundsOf,
  downsampleOf,
  snapTexelsOf,
  tilesOf,
  traceSize,
  writeDfshFinal,
} from './params.ts'
import { SETTINGS, SUN, camera, dot, near, placed } from './boundsParams.fixture.ts'

test('the two radii: the sphere’s own for the grid of tiles, that rounded up to a centimetre for the space', () => {
  const image = camera()
  const bounds = boundsOf(image, SUN)
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
  const small = {
    ...SUN,
    cascade: { ...SUN.cascade, near: 10.5, far: 11 },
  }
  const { bounds, floats } = placed([0, 0, 0], small)
  assert.ok(bounds.roundedRadius < 5000, `${bounds.roundedRadius}`)
  const at = DFSH_PARAMS.at.toShadow
  const depthOf = (offset: number) => {
    const p = bounds.centre.map((x, k) => x + SUN.toLight[k] * offset)
    return [0, 1, 2].reduce((sum, k) => sum + floats[at + k * 4 + 2] * p[k], 0) + floats[at + 14]
  }
  near(depthOf(0), 0.5, 'the middle', 1e-5)
  near(depthOf(-5000), 0, 'the far end', 1e-5)
  near(depthOf(5000), 1, 'the near end', 1e-5)
  // A larger sphere sets its own range.
  const { bounds: large, floats: wide } = placed([0, 0, 0])
  const radius = large.roundedRadius
  assert.ok(radius > 5000)
  const top = large.centre.map((x, k) => x + SUN.toLight[k] * radius)
  const edge = [0, 1, 2].reduce((sum, k) => sum + wide[at + k * 4 + 2] * top[k], wide[at + 14])
  near(edge, 1, 'a radius toward the light', 1e-5)
})

test('the trace is at half the view’s size unless it is at the view’s', () => {
  assert.equal(downsampleOf({ fullResolution: false }), 2)
  assert.equal(downsampleOf({ fullResolution: true }), 1)
  assert.deepEqual(traceSize([1001, 500], 2), [501, 250])
  assert.deepEqual(traceSize([1001, 500], 1), [1001, 500])
})

test('the final pass is told each lane’s cascade in centimetres, a lane with none left empty', () => {
  const image = camera()
  const floats = new Float32Array(DFSH_FINAL.words)
  const words = new Uint32Array(floats.buffer)
  writeDfshFinal(floats, words, image, [SUN], SETTINGS)
  const at = DFSH_FINAL.at
  const lane = (k: number) => at.lights + k * 12
  assert.deepEqual([...words.subarray(at.view, at.view + 4)], [1000, 500, 2, 1])
  assert.deepEqual([...words.subarray(at.extent, at.extent + 2)], [1024, 512])
  assert.deepEqual(
    [...words.subarray(lane(0) + 8, lane(0) + 12)],
    [0, 0, 0, 0],
    'no cascade for lane 0',
  )
  assert.deepEqual([...words.subarray(lane(1) + 8, lane(1) + 12)], [1, 0, 0, 0], 'lane 1, layer 0')
  near(floats[lane(1)], 7300, 'minimum depth')
  near(floats[lane(1) + 1], 51200, 'maximum depth')
  near(floats[lane(1) + 2], 50000, 'where it fades out')
  near(floats[lane(1) + 3], 1 / 1200, 'the inverse length, per centimetre', 1e-6)
  near(floats[lane(1) + 4], 7300, 'where it fades in')
  assert.equal(floats[lane(1) + 6], 1, 'the share it keeps')
})
