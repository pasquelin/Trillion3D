// Frames as a tiled GPU reports them: a render pass begins at its vertex stage, a
// compute pass at its start, so the starts are out of the submission's order and the passes
// overlap; a pass that did no work leaves the pair an earlier image wrote, or zero, or only its
// end; and a resolve can land a frame late. None of it is a reason for the image to have no GPU
// time while the passes that ran have theirs: `summarizeTimestamps` spans the valid pairs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { PART } from '../../../../../tests/kit/gpu/timingDevice.ts'
import { MS, timer } from './imageTimer.fixture.ts'
import { summarizeTimestamps } from './sample.ts'
import { createSlotMemory } from './slotMemory.ts'

// Passes of one image, as submitted: a compute cull (A), the depth render (B) that began before it,
// a compute (C), the lighting render (D), a render (E) and a closing compute (F).
const A = 0,
  B = 1,
  D = 3,
  E = 4
const frame1: [number, number][] = [
  [100, 104], // A
  [98, 112], // B: begun at its vertex stage, ahead of A
  [104, 107], // C
  [105, 116], // D: overlaps B
  [0, 0], // E: skipped, its slots never written
  [110, 114], // F
]
// Image 2: D did no work and keeps image 1's pair; E now runs.
const frame2: [number, number][] = [
  [200, 204],
  [198, 212],
  [204, 207],
  [105, 116],
  [206, 215],
  [210, 214],
]
// Image 3: E skipped again and reads zero after it held a time; B drew nothing, so its beginning
// (the vertex stage's) is image 2's while its end is new.
const frame3: [number, number][] = [
  [300, 304],
  [198, 311],
  [304, 307],
  [305, 316],
  [0, 0],
  [310, 314],
]

test('overlapping passes, out-of-order starts, repeated pairs, zeros and a late resolve: the span is the valid pairs', async () => {
  const { timing, samples, image } = timer()
  for (const [at, passes] of [frame1, frame2, frame3].entries()) {
    image(at + 1, passes)
    await timing.flush()
  }
  // A late resolve: image 4's readback still holds image 3's pairs, image 5's holds image 4's own.
  image(4, frame3)
  await timing.flush()
  image(5, [
    [400, 404],
    [398, 412],
    [404, 407],
    [405, 416],
    [406, 415],
    [410, 414],
  ])
  await timing.flush()
  const [one, two, three, late, landed] = samples

  // Image 1: E never wrote. The span is B's beginning to D's end: 98 → 116, one submission.
  assert.deepEqual(one.pairs, { valid: 5, unwritten: 1, invalid: 0 })
  assert.equal(one.frameMs, 18)
  assert.equal(one.submittedMs, 18)
  assert.equal(one.hostGapMs, 0)
  assert.equal(one.frameMsReason, null)
  assert.equal(one.passes[E].reason, 'unwritten-timestamps')
  assert.equal(one.totalMs, null, 'a sum of passes holds none for a pass without a time')
  // The own shares count an overlap once on the pass submitted first, and are not the span.
  assert.deepEqual(
    one.passes.map((pass: { ownMs?: number }) => pass.ownMs),
    [4, 8, 0, 4, undefined, 0],
  )

  // Image 2: D's pair is image 1's, a pass that did no work: its slots add no time.
  assert.deepEqual(two.pairs, { valid: 5, unwritten: 1, invalid: 0 })
  assert.equal(two.passes[D].reason, 'unwritten-timestamps')
  assert.equal(two.frameMs, 17, '198 → 215')
  assert.equal(two.submittedMs, 17)

  // Image 3: E reads zero where its slot held 206 → 215, and B's end is new on an old beginning.
  assert.deepEqual(three.pairs, { valid: 4, unwritten: 1, invalid: 1 })
  assert.equal(three.passes[E].reason, 'unwritten-timestamps')
  assert.equal(three.passes[B].reason, 'invalid-timestamps')
  assert.equal(three.passes[A].gpuMs, 4)
  assert.equal(three.frameMs, 16, '300 → 316: B owns no beginning, so no span of 118 ms')
  assert.equal(three.submittedMs, 16)
  assert.equal(three.frameMsReason, null)

  // Image 4: nothing but image 3's pairs. No pair of its own: no span, and the reason is named.
  assert.deepEqual(late.pairs, { valid: 0, unwritten: 6, invalid: 0 })
  assert.equal(late.frameMs, null)
  assert.equal(late.submittedMs, null)
  assert.equal(late.frameMsReason, 'no-valid-pair')

  // Image 5: every pair is new; the span is back.
  assert.deepEqual(landed.pairs, { valid: 6, unwritten: 0, invalid: 0 })
  assert.equal(landed.frameMs, 18)
  assert.equal(landed.submittedMs, 18)
  assert.equal(landed.frameMsReason, null)
  assert.equal(timing.stats().invalidSamples, 1, 'only B of image 3 could not be read')
  timing.dispose()
})

test('two submissions the device overlaps cover their overlap once: no sum of spans, no negative host gap', async () => {
  // The render encoder's first pass begins at its vertex stage, before the selection encoder's
  // last pass ends: 0 → 10 ms and 8 → 20 ms.
  const { f, timing, samples } = timer()
  const selection = timing.createEncoder(1)
  selection.beginComputePass({ label: 'selection' }).end()
  selection.finish()
  const render = timing.createEncoder(1)
  render.beginRenderPass({ label: 'lighting', colorAttachments: [] }).end()
  render.beginComputePass({ label: 'resolve' }).end()
  render.finish()
  const values = new BigUint64Array(f.buffers[1].getMappedRange())
  values.set([1n * MS, 10n * MS], 0)
  values.set([8n * MS, 14n * MS, 15n * MS, 20n * MS], PART)
  timing.submitted(render, {})
  await timing.flush()
  const [sample] = samples
  assert.equal(sample.frameMs, 19, '1 → 20')
  assert.equal(sample.submittedMs, 19, 'the 2 ms the spans share are counted once')
  assert.deepEqual(
    (sample.submissions as { spanMs: number }[]).map((span) => span.spanMs),
    [9, 12],
  )
  assert.equal(sample.hostGapMs, 0)
  timing.dispose()
})

test('a timestamp is stale when its slot held it, and a late reader compares nothing', () => {
  const memory = createSlotMemory(4)
  const first = memory.read(1)
  assert.deepEqual([first(0, 5n), first(1, 6n)], [false, false])
  const second = memory.read(2)
  assert.deepEqual([second(0, 5n), second(1, 7n)], [true, false])
  const late = memory.read(1)
  assert.equal(late(0, 7n), false, 'image 1 is behind image 2: its slots are not compared')
})

test('a pair of two stale timestamps is unwritten, one stale or reversed is invalid, neither voids the span', () => {
  const entries = [0, 2, 4, 6].map((slot) => ({ slot, name: 'pass', part: 0 }))
  const values = new BigUint64Array([5, 9, 7, 9, 9, 8, 3, 6].map((ms) => BigInt(ms) * MS))
  // Slots 0 to 2 hold what they read: both of the first pair, and the second pair's beginning.
  const { sample, span } = summarizeTimestamps(entries, values, false, (slot) => slot <= 2)
  assert.deepEqual(sample.pairs, { valid: 1, unwritten: 1, invalid: 2 })
  assert.equal(sample.frameMs, 3)
  assert.equal(sample.frameMsReason, null)
  assert.equal(span, null, 'a pass that ran has no time: no end to measure the next idle from')
  // A skipped pass ran nothing: the passes that ran hold the image's two ends.
  const ran = [entries[0], entries[3]]
  const skipped = summarizeTimestamps(ran, values.fill(0n, 0, 2), false, () => false)
  assert.deepEqual(skipped.sample.pairs, { valid: 1, unwritten: 1, invalid: 0 })
  assert.deepEqual(skipped.span, { beginNs: 3n * MS, endNs: 6n * MS })
})

test('a truncated image has no span whatever its pairs, and says so', async () => {
  const { timing, samples } = timer()
  const first = timing.createEncoder(1)
  first.beginComputePass({ label: 'a' }).end()
  const second = timing.createEncoder(1)
  second.beginComputePass({ label: 'b' }).end()
  // The first encoder's next pass would take the slots behind the second's: left untimed.
  first.beginComputePass({ label: 'c' }).end()
  first.finish()
  second.finish()
  timing.submitted(second, {})
  await timing.flush()
  assert.equal(samples[0].truncated, true)
  assert.equal(samples[0].frameMs, null)
  assert.equal(samples[0].frameMsReason, 'truncated')
  assert.deepEqual(samples[0].pairs, { valid: 2, unwritten: 0, invalid: 0 })
  timing.dispose()
})
