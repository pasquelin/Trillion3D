// The frame cap (`cadence.ts`) on vsync: a cap is a whole number of the
// display's refreshes, the loop drawing on every n-th one; the auto scale fits its images to the
// cap's interval.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createScaleControl } from './scaleControl.ts'
import { createFrameCap, resetFrameCap } from './cadence.ts'
import { HZ120, HZ60 } from './scaleFit.fixture.ts'
import { LAG, intervals, run } from './cadence.fixture.ts'

test("a frame cap is a whole number of the display's refreshes, the fastest at or under it", () => {
  /** The refreshes of `period` ms a drawn frame spans at least under a cap of `cap` a second. */
  const capFloor = (cap: number, period: number) => {
    const frameCap = createFrameCap(cap)
    resetFrameCap(frameCap, period)
    return frameCap.floor
  }
  assert.equal(capFloor(12, HZ60), 5)
  assert.equal(capFloor(12, HZ120), 10)
  assert.equal(capFloor(12, 1000 / 165), 14, '11.8 a second: never above the cap')
  assert.equal(capFloor(50, HZ120), 3)
  assert.equal(capFloor(60, HZ60 * 1.01), 1, 'a refresh a hair long is still the refresh')
  for (const none of [Infinity, 0, -1, Number.NaN]) assert.equal(capFloor(none, HZ120), 1)
})

test('a page capped at 12 frames a second draws every tenth refresh at 120 Hz', () => {
  const control = createScaleControl(undefined, 12)
  // The refresh is measured on the first frames, drawn on every refresh.
  const first = run(control, 0.1, () => 3)
  const capped = run(control, 3, () => 3, first.at)
  assert.deepEqual(new Set(intervals(capped.shown)), new Set([10]))
  // Lifted, the loop draws on every refresh again.
  control.maxFrameRate = Infinity
  const free = run(control, 0.5, () => 3, capped.at)
  assert.deepEqual(new Set(intervals(free.shown)), new Set([1]))
})

test('under a cap the auto scale fits its images to the cap, not the refresh', () => {
  const control = createScaleControl('auto', 12)
  let now = 0
  // 20 ms of GPU at full scale: over a refresh at 120 Hz, well within a twelfth of a second.
  for (let k = 0, lag: number[] = []; k < 1200; k++, now += HZ120) {
    control.tick(now, true)
    if (control.measuring) {
      control.hold()
      continue
    }
    if (control.skips(now)) continue
    const s = control.wanted()
    control.drew(s, true)
    lag.push(20 * s * s)
    if (lag.length > LAG) control.observe(lag.shift()!, s)
  }
  assert.equal(control.wanted(), 1, 'the scale stays whole')
})
