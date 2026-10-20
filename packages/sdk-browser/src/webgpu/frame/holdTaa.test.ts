// A view whose temporal pass runs draws every frame: it is never held; a view
// that does not accumulate holds as before.
import test from 'node:test'
import assert from 'node:assert/strict'
import { holdWebgpuFrame, keepWebgpuFrame } from './hold.ts'
import { createTaaFrameState } from '../../taa/frameState.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { settledRt } from './hold.fixture.ts'

installGpuGlobals()

/** A settled runtime with temporal accumulation on, the hold armed by two identical frames. */
function heldRuntime() {
  const rt = settledRt()
  const frame = createTaaFrameState()
  frame.viewSeen = rt.run.gate.temporalRevision
  Object.assign(rt.gpu, {
    temporalWanted: true,
    targetSize: [64, 32],
    allocatedSize: [64, 32],
    displaySize: [64, 32],
    temporal: { frame },
  })
  Object.assign(rt.run, { diagnostic: 'beauty', textureConverging: false })
  for (let i = 0; i < 2; i++) {
    rt.run.frame++
    keepWebgpuFrame(rt)
  }
  return { rt, frame }
}

test('a quiet view whose temporal pass runs is drawn every frame, its jitter running on', () => {
  const { rt, frame } = heldRuntime()
  const { device } = fakeDevice()
  for (let i = 0; i < 3; i++) assert.equal(holdWebgpuFrame(rt, device), false)
  assert.equal(rt.run.frameHeld, false)
})

test('a view that does not accumulate holds its quiet frame', () => {
  const { rt } = heldRuntime()
  const { device } = fakeDevice()
  rt.run.diagnostic = 'wireframe'
  assert.equal(holdWebgpuFrame(rt, device), true)
})
