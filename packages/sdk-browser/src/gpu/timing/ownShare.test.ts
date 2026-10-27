// A device that overlaps passes reports each one's whole span; the own share counts an
// overlap once, on the pass the queue ran first, so the shares add up to the image.
import test from 'node:test'
import assert from 'node:assert/strict'
import { timedDevice } from './imageTimer.fixture.ts'
import { summarizeTimestamps } from './sample.ts'
import { passWindowMs } from './spans.ts'
import { createGpuTiming } from './timing.ts'

const ms = (value: number) => BigInt(value * 1e6)

test('overlapping passes keep their spans and get each its own share of the image', () => {
  const names = ['water composite', 'temporal antialiasing', 'composition', 'unmeasured']
  const entries = names.map((name, i) => ({ slot: i * 2, name, part: 0 }))
  // 1 → 46, 11 → 51 and 13 → 53 ms: three spans that overlap; the last pair is invalid.
  const values = new BigUint64Array([ms(1), ms(46), ms(11), ms(51), ms(13), ms(53), 0n, ms(9)])
  const { sample } = summarizeTimestamps(entries, values, false, () => false)
  assert.deepEqual(
    sample.passes.map((pass) => [pass.gpuMs, 'ownMs' in pass ? pass.ownMs : undefined]),
    [
      [45, 45],
      [40, 5],
      [40, 2],
      [null, undefined],
    ],
  )
})

test('each timed pass is placed on its image’s timeline, from the image’s earliest beginning; a pass with no pair is not', () => {
  const names = ['water composite', 'temporal antialiasing', 'composition', 'unmeasured']
  const entries = names.map((name, i) => ({ slot: i * 2, name, part: 0 }))
  const values = new BigUint64Array([ms(1), ms(46), ms(11), ms(51), ms(13), ms(53), 0n, ms(9)])
  const { sample } = summarizeTimestamps(entries, values, false, () => false)
  assert.deepEqual(
    sample.passes.map((pass) => [pass.beginMs, pass.endMs]),
    [
      [0, 45],
      [10, 50],
      [12, 52],
      [undefined, undefined],
    ],
  )
})

test('the window of the passes a predicate picks: first beginning to last end, gaps in; 0 for none that ran, null where one has no pair', () => {
  const names = ['a', 'other', 'b', 'unmeasured']
  const entries = names.map((name, i) => ({ slot: i * 2, name, part: 0 }))
  // a 1 → 3, other 4 → 5, b 6 → 9 ms; the last pair is unwritten.
  const values = new BigUint64Array([ms(1), ms(3), ms(4), ms(5), ms(6), ms(9), 0n, 0n])
  const { sample } = summarizeTimestamps(entries, values, false, () => false)
  assert.equal(
    passWindowMs(sample, (name) => name === 'a' || name === 'b'),
    8,
    'the pass between them and the gaps are in it',
  )
  assert.equal(
    passWindowMs(sample, (name) => name === 'other'),
    1,
  )
  assert.equal(
    passWindowMs(sample, () => false),
    0,
    'none picked ran',
  )
  assert.equal(
    passWindowMs(sample, (name) => name !== 'other'),
    null,
    'a picked pass without a usable pair',
  )
  assert.equal(
    passWindowMs(null, () => true),
    null,
    'no sample',
  )
  const truncated = summarizeTimestamps(entries, values, true, () => false).sample
  assert.equal(
    passWindowMs(truncated, (name) => name === 'a'),
    null,
    'a truncated sample',
  )
})

// On a tiled GPU a render pass's beginning is its vertex stage's, started ahead of a compute pass
// submitted before it: the composition's full-screen triangle begins while the lighting draws,
// before a compute pass (the light tiles) it waits on. The compute pass keeps its own share, and
// the composition only what it adds after it.
test('a compute pass keeps its share from a render pass submitted after it that began earlier', async () => {
  const f = timedDevice(),
    samples: any[] = []
  const timer = createGpuTiming(f.device, { onSample: (sample) => void samples.push(sample) })
  const encoder = timer.createEncoder(1)
  encoder.beginRenderPass({ label: 'lighting', colorAttachments: [] }).end()
  encoder.beginComputePass({ label: 'light tiles' }).end()
  encoder.beginRenderPass({ label: 'composition', colorAttachments: [] }).end()
  encoder.finish()
  // 1 → 4, 4 → 6 and 2 → 7 ms, as the readback of this image reads them.
  new BigUint64Array(f.buffers[1].getMappedRange()).set([1, 4, 4, 6, 2, 7].map(ms))
  timer.submitted(encoder, {})
  await timer.flush()
  assert.deepEqual(samples[0].passes, [
    { name: 'lighting', gpuMs: 3, ownMs: 3, beginMs: 0, endMs: 3 },
    { name: 'light tiles', gpuMs: 2, ownMs: 2, beginMs: 3, endMs: 5 },
    { name: 'composition', gpuMs: 5, ownMs: 1, beginMs: 1, endMs: 6 },
  ])
  assert.equal(samples[0].frameMs, 6, 'the shares add up to the image')
  timer.dispose()
})
