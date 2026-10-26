// What the lighting reads of a real-time capture: nothing until the first cube has been drawn
// whole, then the ready one — a cube made and never drawn into holds no sky, and a surface or a
// bounce probe that read it would be lit by a black one.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readCaptured } from './readCaptured.ts'
import { advanceCapture, newCaptureState } from './schedule.ts'
import type { SkyLightTargets } from './targets.ts'

const TARGETS = {
  filteredArray: {},
  mips: 8,
  harmonics: {},
} as unknown as SkyLightTargets
const NO_CUBEMAP = { done: false } as never
const NO_SCENE = { done: false } as never
const OPTIONS = { timeSlice: true, facesPerFrame: 2, mips: 8 }

const read = (state = newCaptureState()) =>
  readCaptured(TARGETS, 'realTime', state, NO_CUBEMAP, NO_SCENE)

test('a real-time capture is read only once its first cube has been drawn whole', () => {
  const state = newCaptureState()
  assert.equal(read(state), undefined, 'targets made, nothing drawn: no sky yet')
  assert.equal(advanceCapture(state, OPTIONS).kind, 'whole', 'the first frame draws it whole')
  const ready = read(state)
  assert.equal(ready?.layer, 0)
  assert.equal(ready?.cube, TARGETS.filteredArray)
})

test('a capture not time sliced is read from its first frame', () => {
  const state = newCaptureState()
  advanceCapture(state, { ...OPTIONS, timeSlice: false })
  assert.ok(read(state))
})

test('a capture started again (a cube made again) reads nothing until it is drawn whole again', () => {
  const state = newCaptureState()
  advanceCapture(state, OPTIONS)
  assert.ok(read(state))
  const restarted = newCaptureState()
  assert.equal(read(restarted), undefined)
  advanceCapture(restarted, OPTIONS)
  assert.ok(read(restarted))
})
