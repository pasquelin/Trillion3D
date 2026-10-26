// The temporal pass keeps the number of the image it was last drawn at, and the view's camera of the image before
// (`beginCamera`) is its history's camera where that is the image: an image it skipped leaves it with no camera, and the history
// starts again, as after a cut.
import test from 'node:test'
import assert from 'node:assert/strict'
import { beginCamera } from '../../frame/backend/state/previousCamera.ts'
import { TAA_VIEW } from './bindingsWgsl.ts'
import { runtime } from './frame.fixture.ts'

const CUT = TAA_VIEW.at.params

test('the history reads the camera of the image before while its images follow, and starts again over one it skipped', () => {
  const { rt, cam, velocity, frame } = runtime()
  const state = velocity.frame
  frame(true)
  assert.equal(frame(true)![CUT], 0, 'the second image goes on from the first')
  assert.equal(state.seen, rt.run.frame, 'the image it was last drawn at')
  assert.equal(
    state.before.image,
    rt.run.frame - 1,
    'its camera is the view’s, of the image before',
  )
  assert.equal('previousViewProjection' in state, false, 'it keeps no camera of its own')
  // An image the pass did not run in: the frame begins its camera all the same.
  rt.run.frame++
  beginCamera(rt, cam)
  assert.equal(frame(true)![CUT], 1, 'the history’s image is no longer the one before: a cut')
  assert.equal(state.accumulated, 1, 'the count starts again')
  assert.equal(frame(true)![CUT], 0, 'and goes on from there')
})
