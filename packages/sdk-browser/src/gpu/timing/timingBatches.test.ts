import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from '../../../../../tests/kit/gpu/timingDevice.ts'
import { createGpuTiming } from './timing.ts'
import { QUERY_COUNT, TIMED_PASSES } from './queries.ts'
import { VSM_TIMED_PASSES } from './vsmPasses.ts'

// The virtual shadow maps' frame: its passes (`vsmPasses.ts`). The frame of the most chunks it is
// timed over is timed whole, so its shadow milliseconds are published; one past the
// image's passes is truncated.
const frameOf = async (vsmPasses: number) => {
  const f = fixture(),
    samples: any[] = []
  const timer = createGpuTiming(f.device, { onSample: (sample) => void samples.push(sample) })
  const selection = timer.createEncoder(1)
  selection.beginComputePass({ label: 'selection' }).end()
  selection.finish()
  const frame = timer.createEncoder(1)
  const pass = (label: string) => frame.beginComputePass({ label }).end()
  for (let k = 0; k < vsmPasses; k++) pass('vsm.pass')
  for (let k = 0; k < 200; k++) pass('lighting')
  frame.finish()
  const values = new BigUint64Array(f.buffers[1].getMappedRange())
  for (let k = 0; k < QUERY_COUNT; k++) values[k] = BigInt(k + 1) * 1000n
  timer.submitted(frame, { frame: 1 })
  await timer.flush()
  timer.dispose()
  return samples[0]
}

test('a frame of the most virtual shadow passes is timed whole', async () => {
  const sample = await frameOf(VSM_TIMED_PASSES)
  assert.equal(sample.truncated, false, 'every pass timed')
  assert.equal(sample.passes.length, 1 + VSM_TIMED_PASSES + 200)
  assert.ok(sample.passes.length <= TIMED_PASSES)
})

test('a frame past the passes an image is timed over is flagged truncated', async () => {
  const sample = await frameOf(TIMED_PASSES)
  assert.equal(sample.truncated, true)
})
