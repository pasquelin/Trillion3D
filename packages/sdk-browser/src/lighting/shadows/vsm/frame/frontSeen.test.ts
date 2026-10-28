// A marking that has run for no image has seen none: the first image, number 0, is not "the image it ran for".
import test from 'node:test'
import assert from 'node:assert/strict'
import { newFrontSeen } from './vsmFrontLayer.ts'
import { cameraSeen } from '../../../../frame/backend/state/previousCamera.ts'

test('a new marking history has no camera, whatever the number of the image before', () => {
  const before = { viewProjection: new Float64Array(16), eye: new Float64Array(3), image: 0 }
  assert.equal(cameraSeen(before, newFrontSeen().image), undefined)
})
