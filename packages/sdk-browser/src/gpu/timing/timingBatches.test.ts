import test from 'node:test'
import assert from 'node:assert/strict'
import { timedDevice } from './imageTimer.fixture.ts'
import { createGpuTiming } from './timing.ts'
import { QUERY_COUNT, TIMED_PASSES } from './queries.ts'
import { VSM_TIMED_PASSES } from './vsmPasses.ts'
import { VSM_PASS_PREFIX } from '../../diagnostic/stage/passLabels.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createVsmResources } from '../../lighting/shadows/vsm/resources.ts'
import { encodeVsmRender } from '../../lighting/shadows/vsm/render/renderPass.ts'
import { recordingRaster } from '../../lighting/shadows/vsm/recordingRaster.fixture.ts'
import {
  VSM_MAP_ID_BITS,
  VSM_MAX_VIEW_PASSES,
} from '../../lighting/shadows/vsm/render/renderViewPasses.ts'
import type { GpuTimingSample } from './types.ts'

// The virtual shadow maps' frame: its passes (`vsmPasses.ts`). The frame of the most chunks it is
// timed over is timed whole, so its shadow milliseconds are published; one past the
// image's passes is truncated.
const frameOf = async (vsmPasses: number) => {
  const f = timedDevice(),
    samples: any[] = []
  const timer = createGpuTiming(f.device, { onSample: (sample) => void samples.push(sample) })
  const selection = timer.createEncoder(1)
  selection.beginComputePass({ label: 'selection' }).end()
  selection.finish()
  const frame = timer.createEncoder(1)
  const pass = (label: string) => frame.beginComputePass({ label }).end()
  for (let k = 0; k < vsmPasses; k++) pass(`${VSM_PASS_PREFIX}pass`)
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

test('the raster at the most chunks and the most view passes is timed whole, as the passes are sized for', async () => {
  // 65 536 rows in chunks of 256 (a 1 MiB binding): 256 chunks, the chunks a pass is timed over.
  // 65 537 maps in lights of 65 536 and 1, past the 65 535 rows of a dispatch: the most view
  // passes, 2. The raster encodes a compute and a raster pass a chunk of each pass.
  const f = fakeDevice({
    features: ['timestamp-query'],
    limits: { maxStorageBufferBindingSize: 1 << 20, maxBufferSize: 1 << 20 },
  })
  const samples: GpuTimingSample[] = []
  const timer = createGpuTiming(f.device, { onSample: (sample) => void samples.push(sample) })
  const encoder = timer.createEncoder(1)
  const res = createVsmResources(f.device, { fullMapCapacity: 63, poolPages: 256 })
  const { scene } = recordingRaster(f.device, 65_536)
  const lights = [
    { kind: 'point' as const, firstId: 0, count: 1 << VSM_MAP_ID_BITS },
    { kind: 'point' as const, firstId: 1 << VSM_MAP_ID_BITS, count: 1 },
  ]
  const stats = encodeVsmRender(encoder, res, { device: f.device, lights }, scene)!
  encoder.finish()
  const encoded = f.computePasses.length + f.passes.length
  assert.deepEqual([stats.chunks, encoded], [256, 2 * 256 * VSM_MAX_VIEW_PASSES])
  assert.ok(encoded > 2 * 256, 'more passes than the chunks of one view pass')
  const values = new BigUint64Array(f.buffers[1].getMappedRange())
  for (let k = 0; k < QUERY_COUNT; k++) values[k] = BigInt(k + 1) * 1000n
  timer.submitted(encoder, { frame: 1 })
  await timer.flush()
  timer.dispose()
  assert.equal(samples[0].truncated, false, 'every pass timed')
  assert.equal(samples[0].passes.length, encoded)
})
