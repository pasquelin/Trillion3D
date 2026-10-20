import test from 'node:test'
import assert from 'node:assert/strict'
import { createRefreshClock } from './refreshClock.ts'
import { nearly } from '../../../math/src/float/near.fixture.ts'

test('the refresh interval is the period several intervals share, pauses aside', () => {
  const clock = createRefreshClock(1000 / 60)
  assert.equal(clock.display, 1000 / 60, 'the fallback before any frame')
  let now = 0
  for (const gap of [0, 8.4, 16.7, 8.3, 500, 8.3]) clock.tick((now += gap))
  // The period that fits them all: 41.7 ms over five refreshes.
  assert.ok(nearly(clock.display, 8.34, 0.01), `${clock.display}`)
})

/** The refresh measured from frames drawn every `frameMs` on a display refreshing every `vsyncMs`:
 *  each frame begins at the first refresh after it is ready, as rAF does. */
function measured(vsyncMs: number, frameMs: number) {
  const clock = createRefreshClock(1000 / 60)
  for (let frame = 0; frame < 60; frame++)
    clock.tick(Math.ceil((frame * frameMs) / vsyncMs - 1e-9) * vsyncMs)
  return clock.display
}

// The budget follows the display, no fixed cap; slow frames never pass for a slow display.
test('the refresh budget follows the display, a device that misses its cadence included', () => {
  assert.ok(nearly(measured(1000 / 120, 1000 / 120), 8.33, 0.01), '120 Hz: 8.3 ms')
  assert.ok(nearly(measured(1000 / 60, 1000 / 60), 16.67, 0.01), '60 Hz: 16.7 ms')
  assert.ok(nearly(measured(1000 / 120, 1000 / 16), 8.33, 0.01), '16 fps at 120 Hz: 8.3 ms')
})

// The shortest interval was the period, so one late frame set a 2.5 ms budget.
test('one late frame sets no period', () => {
  const clock = createRefreshClock(1000 / 60)
  let now = 0
  for (let frame = 0; frame < 60; frame++) clock.tick((now += 1000 / 120) + (frame === 30 ? 6 : 0))
  assert.ok(nearly(clock.display, 8.33, 0.01), `${clock.display}`)
})

// A period held while each interval stayed on its grid never rose. The cadence of
// frames held two refreshes is no slower display: the refresh holds until its reader says so.
test('the cadence rises once the display slows, the refresh holds, and a reset forgets both', () => {
  const clock = createRefreshClock(1000 / 60)
  let now = 0
  for (let frame = 0; frame < 120; frame++) clock.tick((now += 1000 / 120))
  for (let frame = 0; frame < 30; frame++) clock.tick((now += 1000 / 60))
  assert.ok(nearly(clock.cadence, 8.33, 0.01), 'a second holds the old cadence')
  for (let frame = 0; frame < 40; frame++) clock.tick((now += 1000 / 60))
  assert.ok(nearly(clock.cadence, 16.67, 0.01), `then the new one: ${clock.cadence}`)
  assert.ok(nearly(clock.display, 8.33, 0.01), `the refresh holds: ${clock.display}`)
  clock.reset()
  assert.equal(clock.settled, false)
  assert.ok(Number.isNaN(clock.cadence))
  for (let frame = 0; frame < 4; frame++) clock.tick((now += 1000 / 30))
  assert.ok(nearly(clock.display, 33.33, 0.01) && clock.settled, 'a reset measures anew at once')
})

// The refresh is at most the shortest period the display held; intervals are whole numbers
// of it, so a 60 Hz display, whatever its frames miss, never shows a 120 Hz grid.
test('a shorter cadence lowers the refresh at once; a 60 Hz display never reads 120 Hz', () => {
  const clock = createRefreshClock(1000 / 60)
  let now = 0
  for (let frame = 0; frame < 60; frame++) clock.tick((now += 1000 / 60))
  assert.ok(
    nearly(clock.display, 16.67, 0.01),
    'two refreshes of 120 Hz from the first read as 60 Hz',
  )
  for (let frame = 0; frame < 3; frame++) clock.tick((now += 1000 / 120))
  assert.ok(
    nearly(clock.display, 8.33, 0.01),
    `three at one refresh prove 120 Hz: ${clock.display}`,
  )
  const sixty = createRefreshClock(1000 / 120)
  now = 0
  for (let frame = 0; frame < 600; frame++) {
    // One, two or three refreshes, a ±0.3 ms jitter, as frames that miss and a compositor's.
    sixty.tick((now += (1 + (frame % 3)) * (1000 / 60) + 0.3 * Math.sin(frame)))
    if (sixty.settled)
      assert.ok(Math.abs(sixty.display - 1000 / 60) < 0.2, `frame ${frame}: ${sixty.display}`)
  }
  assert.ok(sixty.settled)
})

// A timer rounded to whole milliseconds reads 120 Hz as 8 and 9 ms, which a tenth of the
// period (0.83 ms) never held: the clock never settled.
test('a timer rounded to the millisecond still measures 120 Hz', () => {
  const clock = createRefreshClock(1000 / 60)
  for (let frame = 0; frame < 120; frame++) clock.tick(Math.round((frame * 1000) / 120))
  assert.ok(clock.settled && nearly(clock.display, 8.33, 0.01), `${clock.display}`)
})

// A variable-refresh display presents a frame once ready, between two refreshes: a 120 Hz
// ProMotion display, the frames held to measure it, then a world's drawn frames (a-wall-of-cameras,
// recorded). A 2.08 ms grid held those few off-grid intervals better than 8.33: the refresh fell
// to it. Once intervals of one refresh were seen, no finer grid is sought.
test('a variable-refresh display presenting off its grid never reads a finer refresh', () => {
  const clock = createRefreshClock(1000 / 60)
  let now = 0
  for (let frame = 0; frame < 10; frame++) clock.tick((now += 1000 / 120))
  for (const gap of [
    49.92, 19.02, 39.78, 49.03, 16.92, 66.04, 34.02, 32.94, 33.01, 41.99, 42.07, 50.06, 33.17,
    41.83, 32.92, 33.76, 33.34, 83.26, 16.67, 24.1, 34.32, 24.95, 33.22, 33.49,
  ]) {
    clock.tick((now += gap))
    assert.ok(nearly(clock.display, 8.33, 0.02), `after ${gap} ms: ${clock.display}`)
  }
})
