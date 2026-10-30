// A command buffer encoded and submitted while the image's own is open — the roots' before a cut
// (`../../placement/roots/rootPasses.ts`) — is timed beside it: each part's passes resume at a run of
// their own, and the passes read in the order the parts were submitted (`encoder.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { MS, PART_ALIGN, timer } from './imageTimer.fixture.ts'

test('a part encoded and submitted while another is open is timed beside it, in submission order', async () => {
  const { f, timing, samples } = timer()
  // The image's encoder takes a pass, then a command buffer of its own goes first (the roots'
  // before a cut), then the image's encoder resumes at its own aligned run.
  const image = timing.createEncoder(1)
  image.beginComputePass({ label: 'deformation' }).end()
  const roots = timing.createEncoder(1)
  roots.beginComputePass({ label: 'roots' }).end()
  roots.finish()
  image.beginComputePass({ label: 'cut' }).end()
  image.finish()
  const starts = f.passDescriptors.map((d) => d!.timestampWrites!.beginningOfPassWriteIndex)
  assert.deepEqual(starts, [0, PART_ALIGN, 2 * PART_ALIGN])
  assert.deepEqual(
    f.resolves.map(({ first, count }) => `${first}+${count}`),
    [`${PART_ALIGN}+2`, '0+2', `${2 * PART_ALIGN}+2`],
    'each run resolves at its own aligned offset',
  )
  const values = new BigUint64Array(f.buffers[1].getMappedRange())
  values.set([4n * MS, 5n * MS], 0)
  values.set([1n * MS, 3n * MS], PART_ALIGN)
  values.set([6n * MS, 8n * MS], 2 * PART_ALIGN)
  timing.submitted(image, {})
  await timing.flush()
  const [sample] = samples
  assert.deepEqual(
    sample.passes.map((pass) => [pass.name, pass.ownMs]),
    [
      ['roots', 2],
      ['deformation', 1],
      ['cut', 2],
    ],
  )
  assert.equal(sample.frameMs, 7)
  assert.equal(sample.submittedMs, 6)
  timing.dispose()
})

test('a part finished but never taken by the queue times nothing: the image closed with the parts that ran reads only those', async () => {
  const { f, timing, samples } = timer()
  const roots = timing.createEncoder(1)
  roots.beginComputePass({ label: 'roots' }).end()
  roots.finish()
  timing.markSubmitted(roots)
  const cut = timing.createEncoder(1)
  cut.beginComputePass({ label: 'cut' }).end()
  cut.finish()
  // The queue took nothing of the cut: its timestamps were never written.
  timing.unreachedPart(cut)
  const values = new BigUint64Array(f.buffers[1].getMappedRange())
  values.set([1n * MS, 3n * MS], 0)
  timing.submitted(cut, {})
  await timing.flush()
  assert.deepEqual(
    samples[0].passes.map((pass) => pass.name),
    ['roots'],
  )
  timing.dispose()
})
