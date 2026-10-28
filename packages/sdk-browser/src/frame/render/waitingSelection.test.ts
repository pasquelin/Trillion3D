// A frame the initial load draws before the root cover is resident sends the cut's selection alone (`dispatchWaitingSelection`):
// it is an image like any other for the GPU timer, which measures it, as it measures every image drawn.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createGpuTiming } from '../../gpu/timing/timing.ts'
import { timedDevice } from '../../gpu/timing/imageTimer.fixture.ts'
import type { GpuTimingSample } from '../../gpu/timing/types.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { dispatchWaitingSelection } from './gpuCutStream.ts'

test('the selection a frame waiting for its root cover sends is timed as an image: one sample for each frame', async () => {
  const f = timedDevice(),
    samples: GpuTimingSample[] = []
  const gpuTiming = createGpuTiming(f.device, {
    sampleEveryFrames: 1,
    onSample: (sample) => void samples.push(sample),
  })
  const view = { scale: { drawn: 1, steered: true } }
  const rt = {
    run: {
      frame: 0,
      imageRevision: 0,
      gpuDrawCalls: 0,
      blendDrawCalls: 0,
      blendSubmittedTriangles: 0,
      lastCamera: null,
      selectionUniforms: {},
      gate: { cam: { eye: [0, 0, 0] } },
      gpuSelection: {
        // The cut: a pass into the encoder it is given, settled once its commands are submitted.
        dispatch(_uniforms: unknown, encoder: GPUCommandEncoder) {
          encoder.beginComputePass({ label: 'cut' }).end()
          return () => undefined
        },
      },
    },
    gpu: { device: f.device, targetSize: [8, 4] },
    timing: { gpuTiming },
    capture: { capturing: false },
    views: { active: view, main: view },
  } as unknown as WebgpuPagesRuntime
  for (let frame = 0; frame < 3; frame++) {
    rt.run.frame = frame
    assert.equal(dispatchWaitingSelection(rt), true)
    // Its readback lands, as the device's would.
    const copy = f.copies.at(-1)?.to
    if (copy)
      new BigUint64Array(copy.getMappedRange()).set([
        BigInt(10 + frame) * 1_000_000n,
        BigInt(11 + frame) * 1_000_000n,
      ])
    await gpuTiming.flush()
  }
  const stats = gpuTiming.stats()
  assert.equal(stats.sampledFrames, 3, 'each frame opened a sample')
  assert.equal(stats.completedSamples, 3, 'and read it back')
  assert.equal(stats.skippedFrames.interval + stats.skippedFrames.busy, 0)
  assert.deepEqual(
    samples.map((sample) => sample.frame),
    [0, 1, 2],
  )
  gpuTiming.dispose()
})
