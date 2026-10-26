// A light shaft chain's history reprojects by the view's camera of the image before (`beginCamera`) where the image it was
// drawn for is that one; a chain that skipped an image since reads no camera, and starts again, as after a cut.
import test from 'node:test'
import assert from 'node:assert/strict'
import { NO_CAMERA, cameraSeen } from '../../../frame/backend/state/previousCamera.ts'
import { createTaaFrameState } from '../../../post/taa/frameState.ts'
import { lightShaftPassSizes } from './layout.ts'
import { writeLightShaftTemporalView } from './temporalDescribe.ts'
import { createLightShaftHistory } from './temporalHistory.ts'
import { LIGHT_SHAFT_TEMPORAL_VIEW as VIEW } from './temporalWgsl.ts'

const SIZES = lightShaftPassSizes({ width: 64, height: 32 }, { width: 64, height: 32 }, 2)
const CAMERA = { viewProjection: new Float64Array(16), eye: new Float64Array(3) }

/** A camera of the image `image`, its view-projection told by a scale on the first column. */
const cameraOf = (image: number, scale: number) => {
  const viewProjection = new Float64Array(16)
  viewProjection[0] = scale
  viewProjection[5] = viewProjection[10] = viewProjection[15] = 1
  return { viewProjection, eye: new Float64Array(3), image }
}

test('the history of a chain keeps the number of the image it was drawn for, and loses it with its images', () => {
  const history = createLightShaftHistory({} as GPUDevice)
  assert.equal(history.seen, 0)
  history.commit(SIZES, 1, 7)
  assert.deepEqual([history.valid, history.seen], [true, 7])
  history.drop()
  assert.deepEqual([history.valid, history.seen], [false, 0])
})

test('the temporal pass reads the camera of the image before where the history is of that image, and cuts over one it skipped', () => {
  const state = createTaaFrameState()
  state.hasHistory = true
  const history = createLightShaftHistory({} as GPUDevice)
  history.commit(SIZES, 1, 7)
  const input = {
    sizes: SIZES,
    state,
    camera: { ...CAMERA, viewProjection: cameraOf(8, 1).viewProjection },
    history,
    exposure: 1,
    frameExposure: 1,
  }
  const words = () => new Float32Array(VIEW.words)
  const before = cameraOf(7, 2)
  const kept = writeLightShaftTemporalView(words(), {
    ...input,
    before: cameraSeen(before, history.seen),
  })
  assert.equal(kept[VIEW.at.cut], 0, 'the image before: the history is read')
  // The last view-projection scales the first column by 2, this one by 1: the motion is the shared camera's, not zero.
  assert.notEqual(kept[VIEW.at.clipToPrevClip], 1, 'moved by the camera of the image before')
  const skipped = writeLightShaftTemporalView(words(), {
    ...input,
    before: cameraSeen(cameraOf(8, 2), history.seen),
  })
  assert.equal(skipped[VIEW.at.cut], 1, 'the history is of an image two before: it starts again')
  const none = writeLightShaftTemporalView(words(), { ...input, before: cameraSeen(NO_CAMERA, 7) })
  assert.equal(none[VIEW.at.cut], 1, 'no camera was kept: a cut')
})
