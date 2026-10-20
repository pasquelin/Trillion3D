// The bound windows: each reads, ranks and forgets the images filed since it opened or was reset.
import test from 'node:test'
import assert from 'node:assert/strict'
import { file, profilerOf } from './profiler.fixture.ts'

test("a window's reset opens it again unread, and leaves every other window as it was", () => {
  const profiler = profilerOf()
  const host = profiler.openWindow(),
    published = profiler.openWindow()
  file(profiler, 1, 5, 1)
  host.reset()
  assert.equal(host.read(), null)
  assert.equal(published.read()?.frames, 1)
})

test('a window opened late reads only the images filed after it opened', () => {
  const profiler = profilerOf()
  file(profiler, 1, 5, 1)
  const late = profiler.openWindow()
  assert.equal(late.read(), null)
  file(profiler, 2, 6, 1)
  assert.deepEqual(
    late.read()?.worst.map((entry) => entry.frame),
    [2],
  )
})

test('a window ranks the worst images by total, reports a percentile per bound, and forgets both', () => {
  const profiler = profilerOf({ worst: 2 })
  const published = profiler.openWindow(),
    host = profiler.openWindow()
  for (let frame = 1; frame <= 5; frame++) {
    profiler.row[0] = frame
    profiler.row[1] = 10 - frame
    profiler.record(frame, frame)
  }
  const summary = published.read()!
  assert.equal(summary.frames, 5)
  assert.deepEqual(summary.steps.aMs, { p50: 3, p95: 5, max: 5 })
  assert.deepEqual(summary.steps.bMs, { p50: 7, p95: 9, max: 9 })
  assert.deepEqual(
    summary.worst.map((entry) => entry.frame),
    [5, 4],
  )
  assert.equal(summary.worst[0].aMs, 5)
  assert.equal(published.read(), null)
  assert.equal(host.read()?.frames, 5, 'the other window still holds every image')
})

test('a bound an image did not file stays out of its quantiles; one no image filed reads NaN', () => {
  const profiler = profilerOf()
  const window = profiler.openWindow()
  for (const ms of [0.3, NaN, NaN, 0.1]) file(profiler, 1, ms, NaN)
  const summary = window.read()!
  assert.equal(summary.frames, 4, 'the images are all filed')
  assert.deepEqual(summary.steps.aMs, { p50: 0.1, p95: 0.3, max: 0.3 })
  assert.ok(Object.values(summary.steps.bMs).every(Number.isNaN), 'unmeasured, never zero')
})

test('the bound ring keeps the most recent images once capacity is reached', () => {
  const profiler = profilerOf({ stepCapacity: 2, worst: 1 })
  const window = profiler.openWindow()
  for (const value of [1, 2, 3]) file(profiler, value, value, NaN)
  const summary = window.read()!
  assert.equal(summary.frames, 2)
  assert.deepEqual(summary.steps.aMs, { p50: 2, p95: 3, max: 3 })
  assert.equal(summary.worst[0].frame, 3)
})

test('a window reset after the ring wrapped reads only its own images', () => {
  const profiler = profilerOf({ stepCapacity: 4 })
  const window = profiler.openWindow()
  for (const value of [1, 2, 3, 4, 5]) file(profiler, value, value, NaN)
  window.reset()
  for (const value of [6, 7]) file(profiler, value, value, NaN)
  const summary = window.read()!
  assert.equal(summary.frames, 2)
  assert.deepEqual(summary.steps.aMs, { p50: 6, p95: 7, max: 7 })
})
