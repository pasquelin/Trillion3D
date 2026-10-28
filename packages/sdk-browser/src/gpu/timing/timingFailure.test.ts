// An image whose timestamps cannot be summarised is a failed sample, not the end of the timer: the next image is timed as any.
import test from 'node:test'
import assert from 'node:assert/strict'
import { timer } from './imageTimer.fixture.ts'

test('a summary that fails reports its error and leaves the timer on, the next image sampled', async () => {
  const { f, timing, samples, image } = timer(1)
  assert.equal(image(0, [[1, 2]]), true)
  // The device hands back less than the image wrote: reading it fails after the mapping succeeded.
  // Once: the next image's readback, which may use the same buffer, hands back what it wrote.
  const to = f.copies.at(-1)!.to
  const whole = to.getMappedRange.bind(to)
  to.getMappedRange = () => ((to.getMappedRange = whole), new ArrayBuffer(8))
  await timing.flush()
  assert.equal(samples.length, 1)
  assert.equal(samples[0].totalMs, null)
  assert.match(String(samples[0].error), /RangeError|length/i)
  assert.equal(timing.supported, true, 'the timer stays on')
  assert.equal(image(1, [[3, 5]]), true, 'the next image is sampled')
  await timing.flush()
  assert.equal(samples.length, 2)
  assert.equal(samples[1].error, undefined)
  assert.equal(samples[1].totalMs, 2)
  timing.dispose()
})
