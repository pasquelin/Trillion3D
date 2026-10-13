// What the timer's sample hands the render-scale controller (`timing.ts`): the image's span, whole
// when every pass that ran was read, a lower bound when a pass's pair could not be read.
import test from 'node:test'
import assert from 'node:assert/strict'
import { MS, timedDevice } from '../../../gpu/timing/imageTimer.fixture.ts'
import { prepareGpuTiming } from './timing.ts'
import { createWebgpuTimingState } from '../state/timing.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

async function observed(pairs: [bigint, bigint][]) {
  const f = timedDevice(),
    seen: [number | null, boolean][] = []
  const rt = {
    timing: createWebgpuTimingState(),
    diag: { traceEnabled: false, engineDiagnostic() {} },
    scale: {
      bounds: { auto: false },
      observe: (gpuMs: number | null, _scale: number, _steered: boolean, whole: boolean) =>
        void seen.push([gpuMs, whole]),
    },
    bounce: {},
  } as unknown as WebgpuPagesRuntime
  prepareGpuTiming(rt, f.device)
  const timing = rt.timing.gpuTiming!
  const encoder = timing.createEncoder(1)
  for (const _ of pairs) encoder.beginComputePass({ label: 'pass' }).end()
  encoder.finish()
  const read = new BigUint64Array(f.buffers[1].getMappedRange())
  pairs.forEach(([begin, end], i) => read.set([begin * MS, end * MS], i * 2))
  timing.submitted(encoder, { frame: 1 })
  await timing.flush()
  timing.dispose()
  return seen
}

test('the controller reads the span of an image whose every pass was read', async () => {
  assert.deepEqual(
    await observed([
      [1n, 3n],
      [4n, 7n],
    ]),
    [[6, true]],
  )
})

test('an image with a pass whose timestamps cannot be read hands its span as a lower bound', async () => {
  assert.deepEqual(
    await observed([
      [1n, 3n],
      [4n, 0n],
    ]),
    [[2, false]],
  )
})
