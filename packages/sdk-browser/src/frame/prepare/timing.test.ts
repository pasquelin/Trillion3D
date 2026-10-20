// What the timer's sample hands the render-scale controller (`timing.ts`): the image's GPU busy
// time when every pass that ran was read, none when a pass's pair could not be read.
import test from 'node:test'
import assert from 'node:assert/strict'
import { MS, timedDevice } from '../../gpu/timing/imageTimer.fixture.ts'
import { prepareGpuTiming } from './timing.ts'
import { createWebgpuTimingState } from '../backend/state/timing.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

async function observed(pairs: [bigint, bigint][]) {
  const f = timedDevice(),
    seen: (number | null)[] = []
  // The main view drawn, alone: its scale the world's controller.
  const main = {
    scale: {
      bounds: { auto: false },
      observe: (gpuMs: number | null) => void seen.push(gpuMs),
    },
  }
  const rt = {
    timing: createWebgpuTimingState(),
    views: { main, active: main, persistent: [] },
    diag: { traceEnabled: false, engineDiagnostic() {} },
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

test('the controller reads the busy time of an image whose every pass was read', async () => {
  assert.deepEqual(
    await observed([
      [1n, 3n],
      [4n, 7n],
    ]),
    [6],
  )
})

test('an image with a pass whose timestamps cannot be read hands no time', async () => {
  assert.deepEqual(
    await observed([
      [1n, 3n],
      [4n, 0n],
    ]),
    [null],
  )
})
