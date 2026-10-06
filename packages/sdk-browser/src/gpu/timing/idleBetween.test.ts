import test from 'node:test'
import assert from 'node:assert/strict'
import { MS, timer } from './imageTimer.fixture.ts'
import { createTimeline } from './timeline.ts'

/** A device span from `begin` to `end` ms. */
const span = (begin: number, end: number) => ({
  beginNs: BigInt(begin) * MS,
  endNs: BigInt(end) * MS,
})

test('two neighbouring images publish exactly the device idle between them', async () => {
  const { timing, samples, image } = timer()
  image(1, [[1, 3]])
  await timing.flush()
  // One submission: `hostGapMs` is zero and cannot hold the idle, the new field does.
  image(2, [[5, 9]])
  await timing.flush()
  assert.equal(samples[0].idleBetweenMs, null, 'no image before the first')
  assert.equal(samples[1].idleBetweenMs, 2)
  assert.equal(samples[1].hostGapMs, 0)
  assert.equal(samples[1].frameMs, 4, 'the image itself is untouched')
  timing.dispose()
})

test('the image after a sampled one is read into the second readback, so the pair needs no wait', async () => {
  const { timing, samples, image } = timer(12)
  assert.equal(image(1, [[1, 3]]), true)
  // Image 1's readback is still in flight: image 2, its neighbour, is timed beside it.
  assert.equal(image(2, [[4, 6]]), true)
  assert.equal(timing.stats().pending, 2)
  // Image 3 is neither the cadence's nor a neighbour of one: not sampled.
  assert.equal(image(3, [[7, 8]]), false)
  await timing.flush()
  assert.deepEqual(
    samples.map((sample) => [sample.frame, sample.idleBetweenMs]),
    [
      [1, null],
      [2, 1],
    ],
  )
  assert.equal(timing.stats().maxPending, 2)
  timing.dispose()
})

test('an image whose previous SAMPLED image is not the one before it publishes no idle', async () => {
  // Image 2 ran on the device untimed (a capture, a held frame): the gap from image 1 to image 3
  // holds its work, and is no idle.
  const { timing, samples, image } = timer()
  image(1, [[1, 3]])
  await timing.flush()
  image(3, [[20, 22]])
  await timing.flush()
  assert.equal(samples[1].frame, 3)
  assert.equal(samples[1].idleBetweenMs, null)
  timing.dispose()
})

test('a predecessor not timed whole leaves no end to measure from', () => {
  const timeline = createTimeline()
  // A truncated image or an invalid timestamp resolves no span (`summarizeTimestamps`).
  assert.equal(timeline.read(1, null), null)
  assert.equal(timeline.read(2, span(5, 6)), null)
  assert.equal(timeline.read(3, span(7, 9)), 1)
})

test('a readback landing after a later image leaves nothing and measures nothing', () => {
  const timeline = createTimeline()
  timeline.read(2, span(5, 6))
  assert.equal(timeline.read(1, span(1, 3)), null)
  assert.equal(timeline.read(3, span(8, 9)), 2, 'image 2 is still the end kept')
})

test('a timeline that went backwards, or a pause, publishes no idle; a zero idle is published', () => {
  /** The idle of image 2, `span`, after image 1 ended at 3 ms. */
  const after = (begin: number, end: number) => {
    const timeline = createTimeline()
    timeline.read(1, span(1, 3))
    return timeline.read(2, span(begin, end))
  }
  assert.equal(after(1, 2), null, 'backwards')
  assert.equal(after(3, 4), 0, 'no bubble, measured')
  // The ceiling, `IDLE_CEILING_MS`: 100 ms, the refresh clock's pause.
  assert.equal(after(103, 200), 100)
  assert.equal(after(104, 200), null, 'a pause')
})
