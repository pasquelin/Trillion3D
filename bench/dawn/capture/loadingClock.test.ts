// A play starts from the same instant: the clock stands still while the pages arrive, and the loading is over when its counters have been quiet.
import test from 'node:test'
import assert from 'node:assert/strict'
import { REFRESH_MS, createClock, createLoadingTracker, tickClock } from './frames.ts'

test('a frozen clock gives the page the same time at every frame; a thawed one moves a refresh', () => {
  const clock = createClock()
  clock.frozen = true
  const start = clock.time
  for (let i = 0; i < 5; i++) tickClock(clock)
  assert.equal(clock.time, start)
  assert.equal(clock.frame, 5, 'the frames are still counted')
  clock.frozen = false
  tickClock(clock)
  assert.equal(clock.time, start + REFRESH_MS)
})

test('the loading is over once no page is in flight and the counters were quiet for the images asked', () => {
  const tracker = createLoadingTracker(3)
  const loads = (pageLoads: number, pagesLoading = 0) => ({
    pageLoads,
    textureTilesServed: 7,
    pagesLoading,
  })
  assert.deepEqual(
    [loads(1), loads(2), loads(2), loads(2), loads(3), loads(3), loads(3), loads(3)].map((m) =>
      tracker.push(m),
    ),
    [false, false, false, false, false, false, false, true],
  )
})

test('a page still in flight keeps the loading open, however still the counters', () => {
  const tracker = createLoadingTracker(2)
  const answers = [0, 0, 0, 2, 2, 2, 0, 0, 0].map((pagesLoading) =>
    tracker.push({ pageLoads: 5, textureTilesServed: 1, pagesLoading }),
  )
  assert.deepEqual(answers, [false, false, true, false, false, false, false, true, true])
})

test('a metric the engine does not report fails the bench by name, never reads as quiet', () => {
  const tracker = createLoadingTracker(1)
  assert.throws(
    () => tracker.push({ pageLoads: 1, textureTilesServed: 1 }),
    /BENCH_LOADING.*pagesLoading/,
  )
  assert.throws(
    () => tracker.push({ textureTilesServed: 1, pagesLoading: 0 }),
    /BENCH_LOADING.*pageLoads/,
  )
  assert.throws(() => tracker.push(null), /BENCH_LOADING/)
})
