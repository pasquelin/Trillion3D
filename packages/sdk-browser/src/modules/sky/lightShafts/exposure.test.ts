// The light shafts of an image take the exposure the CPU knows from the pre-exposure fixed at the start
// of the image (`PreExposure.exposure`), the one reading of it, in both places their temporal pass takes
// it: the exposure the light was applied by and the frame's exposure scale.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaftTemporal } from './temporal.ts'

const CAMERA = { viewProjection: new Float64Array(16), eye: new Float64Array(3) }
const FRAME = { active: true } as never

test('the temporal pass of the shafts is told the image’s exposure in both places, and the pre-exposure the light was written by', () => {
  // Distinct numbers: an exposure read from another field of the pre-exposure shows in one of them.
  const pre = { now: 4, exposure: 0.5 }
  const temporal = shaftTemporal({ frame: FRAME }, CAMERA, pre)!
  assert.equal(temporal.applied, 0.5)
  assert.equal(temporal.frameExposure, 0.5)
  assert.equal(temporal.pre, 4)
  assert.equal(temporal.state, FRAME)
  assert.equal(temporal.camera, CAMERA)
  // The next image's exposure reaches both.
  const next = shaftTemporal({ frame: FRAME }, CAMERA, { now: 4, exposure: 2 })!
  assert.deepEqual([next.applied, next.frameExposure], [2, 2])
})

test('a view that keeps no temporal state, or whose temporal pass is not running, filters the shafts over no time', () => {
  assert.equal(shaftTemporal(undefined, CAMERA, { now: 1, exposure: 1 }), undefined)
  assert.equal(
    shaftTemporal({ frame: { active: false } as never }, CAMERA, { now: 1, exposure: 1 }),
    undefined,
  )
})
