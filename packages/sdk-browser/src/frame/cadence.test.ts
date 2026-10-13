// The steady cadence (`cadence.ts`) on a generated display: a GPU that cannot hold 120 Hz is drawn
// on every second refresh, each image shown for the same time; one that holds it is drawn on every
// refresh, untouched; between the two bounds of the hysteresis the divisor stays; a lone spike,
// frames late for the CPU, or a 60 Hz display move nothing.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createScaleControl } from './scaleControl.ts'
import { HZ120, HZ60 } from './scaleFit.fixture.ts'

/** Images the display queues at most: a frame is asked once one is free, as the browser's
 *  animation frames wait for the compositor (`FRAMES_IN_FLIGHT`). */
const QUEUED = 2
/** Images a GPU time arrives late. */
const LAG = 2

type Control = ReturnType<typeof createScaleControl>
/** Where a run ends: the next refresh, and when the GPU is free. */
type At = { refresh: number; free: number }

/**
 * A fixed-scale page for `seconds` on a display refreshing every `period` ms, from `at`: at each
 * refresh `k` the loop draws unless its display frame is left out (`skips`), the main thread is
 * `busy(k)`, or the display still queues `QUEUED` images; the image costs `gpu(k)` ms of GPU time,
 * the GPU runs the images one after the other, and each is shown at the first refresh after its
 * end. Returns when each image was shown and the divisor at each refresh.
 */
function run(
  control: Control,
  seconds: number,
  gpu: (k: number) => number,
  at: At = { refresh: 0, free: 0 },
  options: { period?: number; busy?: (k: number) => boolean } = {},
) {
  const period = options.period ?? HZ120,
    shown: number[] = [],
    divisors: number[] = [],
    late: number[] = [],
    end = at.refresh + Math.round((seconds * 1000) / period)
  for (let k = at.refresh; k < end; k++) {
    const t = k * period
    divisors.push(control.cadence)
    const queued = shown.filter((when) => when > t + 1e-9).length
    if (control.skips(t) || options.busy?.(k) || queued >= QUEUED) continue
    control.tick(t, true)
    const cost = gpu(k)
    at.free = Math.max(at.free, t) + cost
    shown.push(Math.ceil(at.free / period - 1e-9) * period)
    control.drew(1, false, false)
    late.push(cost)
    if (late.length > LAG) control.observe(late.shift()!, 1, false)
  }
  at.refresh = end
  return { shown, divisors, at }
}

/** The intervals between the images shown, in refreshes of `period`. */
const intervals = (shown: number[], period = HZ120) =>
  shown.slice(1).map((when, i) => Math.round((when - shown[i]) / period))

test('a GPU at 9.7 ms on a 120 Hz display is drawn on every second refresh, each image alike', () => {
  const control = createScaleControl(undefined)
  const first = run(control, 0.4, () => 9.7)
  // Before the rule takes it, the images are shown one refresh or two apart, unevenly.
  const before = intervals(first.shown.slice(0, 12))
  assert.ok(before.includes(1) && before.includes(2), `uneven at first: ${before}`)
  assert.equal(control.cadence, 2, 'taken within the first window')
  const steady = run(control, 3, () => 9.7, first.at)
  const after = intervals(steady.shown)
  assert.ok(after.length > 150, `${after.length} images`)
  assert.deepEqual(new Set(after), new Set([2]), 'every image shown two refreshes')
  assert.ok(steady.divisors.every((d) => d === 2))
})

test('a GPU that holds 120 Hz is drawn on every refresh, the rule never taking it', () => {
  // 7.6 and 8 ms lie above the fall bound's cost (0.9 of a refresh): no image is late, nothing moves.
  for (const ms of [5, 7, 7.6, 8]) {
    const control = createScaleControl(undefined)
    const { shown, divisors } = run(control, 3, () => ms)
    assert.ok(
      divisors.every((d) => d === 1),
      `${ms} ms: divisor ${Math.max(...divisors)}`,
    )
    assert.deepEqual(new Set(intervals(shown)), new Set([1]), `${ms} ms: every refresh`)
  }
})

test('the hysteresis: a cost between its bounds keeps the divisor, at the lower one it rises again', () => {
  // The bounds: slower past 0.9 of the cadence's budget with images late, faster at 0.81 of the
  // faster one's — 7.5 and 6.75 ms at 120 Hz.
  const rise = 0.81 * HZ120
  const control = createScaleControl(undefined)
  let r = run(control, 1, () => 9.7)
  assert.equal(control.cadence, 2, 'taken at 9.7 ms')
  r = run(control, 4, () => rise + 0.05, r.at)
  assert.ok(
    r.divisors.every((d) => d === 2),
    'kept between the bounds',
  )
  assert.deepEqual(new Set(intervals(r.shown)), new Set([2]))
  const from = r.at.refresh
  r = run(control, 4, () => rise, r.at)
  const back = r.divisors.indexOf(1)
  assert.ok(back >= 0 && back * HZ120 <= 2000, `back to every refresh after ${back} refreshes`)
  assert.ok(
    r.divisors.slice(back).every((d) => d === 1),
    'and held there',
  )
  const tail = r.shown.filter((when) => when > (from + back) * HZ120 + 500)
  assert.deepEqual(new Set(intervals(tail)), new Set([1]))
})

test('a lone spike, or frames late for the CPU while the GPU holds, move nothing', () => {
  // One image a second at 30 ms: its window's second costliest is the others' 6 ms.
  const spiky = run(createScaleControl(undefined), 4, (k) => (k % 120 === 0 ? 30 : 6))
  assert.ok(spiky.divisors.every((d) => d === 1))
  // The main thread misses every third refresh, the GPU at 4 ms: late images, a GPU that holds.
  const cpu = run(createScaleControl(undefined), 3, () => 4, undefined, {
    busy: (k) => k % 3 === 2,
  })
  assert.ok(cpu.divisors.every((d) => d === 1))
})

test('the slowest cadence is 60 a second: a 60 Hz display is never divided', () => {
  const control = createScaleControl(undefined)
  const r = run(control, 3, () => 20, undefined, { period: HZ60 })
  assert.ok(r.divisors.every((d) => d === 1))
  assert.ok(intervals(r.shown, HZ60).includes(2), 'the 20 ms frames do miss')
})
