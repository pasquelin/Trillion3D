// The horizon occlusion's temporal filter converges over the images it is drawn on, whatever the temporal anti-aliasing does: a
// quiet view is drawn again until its history is within a tenth of its limit, then held; one that draws no such occlusion owes
// nothing.
import test from 'node:test'
import assert from 'node:assert/strict'
import { holdWebgpuFrame, keepWebgpuFrame } from './hold.ts'
import { unsettledMask, unsettledReasons } from './unsettled.ts'
import { settlingImages } from '../../lighting/ao/horizon/frame.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { settledRt } from './hold.fixture.ts'

installGpuGlobals()

/** A settled runtime without the temporal anti-aliasing (its `gpu.temporal` absent, the view's own history none), the hold armed
 *  by two identical frames, holding the occlusion of an image that drew the horizon method. */
function occludedRuntime(horizon = { temporal: true, blend: 0.1 }) {
  const rt = settledRt()
  Object.assign(rt.run, { diagnostic: 'beauty', textureConverging: false })
  for (let i = 0; i < 2; i++) {
    rt.run.frame++
    keepWebgpuFrame(rt)
  }
  const state = { output: {}, settings: { method: 'horizon', horizon }, history: { images: 0 } }
  Object.assign(rt.gpu, { ambientOcclusion: state })
  return { rt, state }
}

test('the images a history needs to come within a tenth of its limit follow the blend it takes of each', () => {
  assert.equal(settlingImages(0.1), 22)
  assert.equal(settlingImages(0.5), 4)
  assert.equal(settlingImages(0.9), 1)
  // Nothing is kept at a blend of 1; nothing moves at a blend of 0: no image to wait for.
  assert.deepEqual([settlingImages(1), settlingImages(0), settlingImages(1.5)], [1, 1, 1])
})

test('a quiet view with the anti-aliasing off is not held until its occlusion history has the images it needs', () => {
  const { rt, state } = occludedRuntime()
  const { device } = fakeDevice()
  state.history.images = 1
  assert.deepEqual(unsettledReasons(unsettledMask(rt)), ['occlusion'])
  assert.equal(holdWebgpuFrame(rt, device), false, 'a history of one image: drawn again')
  state.history.images = 21
  assert.equal(holdWebgpuFrame(rt, device), false, 'one image short')
  state.history.images = 22
  assert.equal(unsettledMask(rt), 0)
  assert.equal(holdWebgpuFrame(rt, device), true, 'the images it needs: held')
})

test('an occlusion with nothing to wait for owes no frame: not horizon, not temporal, nothing drawn', () => {
  const { rt, state } = occludedRuntime()
  state.settings.method = 'disc'
  assert.equal(unsettledMask(rt), 0, 'the disc method has no history')
  state.settings.method = 'horizon'
  state.settings.horizon.temporal = false
  assert.equal(unsettledMask(rt), 0, 'no temporal filter')
  state.settings.horizon.temporal = true
  state.output = undefined as unknown as object
  assert.equal(unsettledMask(rt), 0, 'the last image drew none')
  Object.assign(rt.gpu, { ambientOcclusion: undefined })
  assert.equal(unsettledMask(rt), 0, 'no occlusion state')
})
