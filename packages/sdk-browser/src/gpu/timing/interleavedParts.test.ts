// A command buffer encoded and submitted while the image's own is open — the roots' before a cut
// (`../../placement/rootPasses.ts`) — is timed beside it: each part's passes resume at a run of
// their own, and the passes read in the order the parts were submitted (`encoder.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { PART_ALIGN } from './encoder.ts'
import { MS, timer } from './imageTimer.fixture.ts'

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
  assert.equal(sample.truncated, false)
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
