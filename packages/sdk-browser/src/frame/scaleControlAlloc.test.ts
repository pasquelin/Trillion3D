import test from 'node:test'
import assert from 'node:assert/strict'
import { grown, SAMPLES } from './scaleControlAlloc.fixture.ts'
import { createScaleControl } from './scaleControl.ts'
import { createRefreshClock } from './refreshClock.ts'

test('a thousand display frames create no object: the refresh clock and the control', () => {
  // A 120 Hz display read by a timer rounded to the millisecond — integers, which a call passes
  // without a box of the caller's —, a frame now and then two refreshes long.
  const at = (i: number) => Math.round(((i + Math.floor(i / 7)) * 1000) / 120)
  const clock = createRefreshClock(1000 / 60)
  let i = 0
  const clocked = grown(() => clock.tick(at(i++)), [clock.tick])
  assert.ok(clocked < SAMPLES, `the clock: ${clocked} bytes over ${SAMPLES} frames`)
  // A frame as the engine runs it: drawn at the control's scale, the display's frame, the GPU
  // time of an image. Light images on time: the scale stays whole, so the page boxes no scale either.
  const timed = createScaleControl('auto')
  let j = 0
  const frames = grown(() => {
    timed.drew(1, true)
    timed.tick(Math.round((j * 1000) / 120), true)
    timed.observe(3 + (j++ % 2), 1)
  }, [timed.tick, timed.observe, timed.drew, clock.tick])
  assert.equal(timed.wanted(), 1)
  assert.ok(frames < SAMPLES, `GPU times: ${frames} bytes over ${SAMPLES} frames`)
})
