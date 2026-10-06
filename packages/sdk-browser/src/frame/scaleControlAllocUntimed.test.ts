import test from 'node:test'
import assert from 'node:assert/strict'
import { grown, SAMPLES } from './scaleControlAlloc.fixture.ts'
import { createScaleControl } from './scaleControl.ts'

test('a thousand display frames without GPU times create no object', () => {
  // A 120 Hz display read by a timer rounded to the millisecond — integers, which a call passes
  // without a box of the caller's.
  const at = (i: number) => Math.round((i * 1000) / 120)
  // Without GPU times, each frame interval is the cost the control steps on: frames on time,
  // the scale whole — drawn at 1, a literal, since a scale the page reads through `wanted()` is
  // a number its own call boxes, not the control's.
  const untimed = createScaleControl('auto')
  let k = 0
  const intervals = grown(() => {
    untimed.drew(1, true)
    untimed.tick(at(k++), false)
  }, [untimed.tick, untimed.drew])
  assert.equal(untimed.wanted(), 1)
  assert.ok(intervals < SAMPLES, `frame intervals: ${intervals} bytes over ${SAMPLES} frames`)
})
