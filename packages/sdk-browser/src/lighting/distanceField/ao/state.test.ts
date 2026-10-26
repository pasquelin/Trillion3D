// The sky light's occlusion keeps the number of the image it was last drawn at, not a camera: the view's camera of the image before
// (`../../../frame/backend/state/previousCamera.ts`) is its history's camera where that is the image, and a history that
// skipped one starts again.
import test from 'node:test'
import assert from 'node:assert/strict'
import { cameraSeen, NO_CAMERA } from '../../../frame/backend/state/previousCamera.ts'
import { createSkyOcclusionState, releaseSkyOcclusion } from './state.ts'

test('the occlusion’s history has no image before its first draw and none after it is given back', () => {
  const state = createSkyOcclusionState()
  assert.equal('previous' in state, false, 'no camera of its own')
  assert.equal(state.seen, 0)
  assert.equal(
    cameraSeen(NO_CAMERA, state.seen),
    undefined,
    'no image, no camera: the first image is a cut',
  )
  state.seen = 12
  const before = { viewProjection: new Float64Array(16), eye: new Float64Array(3), image: 12 }
  assert.equal(cameraSeen(before, state.seen), before, 'the image it drew is the one before')
  before.image = 13
  assert.equal(cameraSeen(before, state.seen), undefined, 'an image skipped since: it starts again')
  state.read = { bent: {} as GPUBuffer, params: {} as GPUBuffer }
  releaseSkyOcclusion(state)
  assert.equal(state.seen, 0, 'given back, the next image starts without a history')
  assert.equal(state.read, undefined, 'and the lit pass reads nothing of it')
})
