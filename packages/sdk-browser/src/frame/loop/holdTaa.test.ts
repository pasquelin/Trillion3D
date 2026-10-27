// A view whose temporal pass runs is drawn until its history is whole, then held on its converged
// image like any still view; a change draws again on the history it holds. A view that does not
// accumulate holds as before.
import test from 'node:test'
import assert from 'node:assert/strict'
import { holdWebgpuFrame, keepWebgpuFrame } from './hold.ts'
import { createTaaFrameState, stochasticPhase } from '../../post/taa/frameState.ts'
import { taaConverged } from '../../post/taa/landing.ts'
import { historySampleLaws } from '../../post/taa/historyWgsl.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { settledRt } from './hold.fixture.ts'

installGpuGlobals()

/** A settled runtime with temporal accumulation on, the hold armed by two identical frames. */
function heldRuntime() {
  const rt = settledRt()
  const frame = createTaaFrameState()
  frame.viewSeen = rt.run.gate.temporalRevision
  Object.assign(rt.gpu, {
    temporalLevel: 'max',
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

/** `frame` as `count` images drawn at the display's size leave it: the jitter `count` phases on. */
function accumulate(frame: ReturnType<typeof createTaaFrameState>, count: number) {
  frame.hasHistory = count > 0
  frame.accumulated = count
  frame.sample = count % frame.phases
}

test('a quiet view whose history is not whole is drawn every frame, its jitter running on', () => {
  const { rt } = heldRuntime()
  const { device } = fakeDevice()
  for (let i = 0; i < 3; i++) assert.equal(holdWebgpuFrame(rt, device), false)
  assert.equal(rt.run.frameHeld, false)
})

test('the history is whole after whole cycles holding its most samples at every display pixel', () => {
  const frame = createTaaFrameState()
  const { samples } = historySampleLaws(1)
  // At the display's size every image reaches every pixel: ⌈16 / 11⌉ = 2 cycles of 11 phases.
  const whole = frame.phases * Math.ceil(samples / frame.phases)
  assert.equal(whole, 22)
  accumulate(frame, whole - 1)
  assert.equal(taaConverged(frame, 64, 64), false, 'a phase short')
  accumulate(frame, whole)
  assert.equal(taaConverged(frame, 64, 64), true)
  accumulate(frame, whole + 1)
  assert.equal(taaConverged(frame, 64, 64), false, 'held only at the end of a cycle')
  // At half the display per axis a cycle reaches a pixel a quarter as often: 37 phases, ⌈16 /
  // 9.25⌉ = 2 cycles.
  frame.phases = 37
  accumulate(frame, 74)
  assert.equal(taaConverged(frame, 32, 64), true)
  accumulate(frame, 37)
  assert.equal(taaConverged(frame, 32, 64), false)
})

test('a quiet view whose history is whole is held on the image it last drew, until a change', () => {
  const { rt, frame } = heldRuntime()
  const { device } = fakeDevice()
  accumulate(frame, 22)
  const drawn = rt.run.imageRevision
  assert.equal(holdWebgpuFrame(rt, device), true, 'held: nothing encoded, the image redisplayed')
  assert.equal(rt.run.frameHeld, true)
  assert.equal(frame.accumulated, 22, 'a held frame accumulates nothing')
  assert.equal(rt.run.imageRevision, drawn, 'no present without a drawn image to show')
  // A change breaks the hold: drawn again, on the history it holds — a view cut alone drops it.
  rt.run.gate.resourcesChanged()
  assert.equal(holdWebgpuFrame(rt, device), false)
  assert.equal(frame.hasHistory, true)
})

test('a view that does not accumulate holds its quiet frame', () => {
  const { rt } = heldRuntime()
  const { device } = fakeDevice()
  rt.run.diagnostic = 'wireframe'
  assert.equal(holdWebgpuFrame(rt, device), true)
})

test('a session opened to measure draws its converged temporal view every frame', () => {
  const { rt, frame } = heldRuntime()
  const { device } = fakeDevice()
  accumulate(frame, 22)
  Object.assign(rt.context, { drawConverged: true })
  for (let i = 0; i < 3; i++) assert.equal(holdWebgpuFrame(rt, device), false)
  assert.equal(rt.run.frameHeld, false, 'each frame costs a draw')
})

test('a view without accumulation turns the lighting noise on each image drawn, never on a held one', () => {
  const { rt, frame } = heldRuntime()
  const { device } = fakeDevice()
  rt.gpu.temporalLevel = 'off'
  const settle = () => {
    for (let i = 0; i < 2; i++) {
      rt.run.frame++
      keepWebgpuFrame(rt)
    }
  }
  settle()
  assert.equal(holdWebgpuFrame(rt, device), true)
  assert.equal(stochasticPhase(frame), 0, 'held: no image drawn, the noise as it was')
  for (let image = 1; image <= 3; image++) {
    rt.run.gate.resourcesChanged()
    assert.equal(holdWebgpuFrame(rt, device), false)
    assert.equal(stochasticPhase(frame), image, 'drawn: the next phase')
    settle()
    assert.equal(holdWebgpuFrame(rt, device), true)
    assert.equal(stochasticPhase(frame), image, 'held again: the phase of the image shown')
  }
})
