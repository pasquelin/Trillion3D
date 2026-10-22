// What the timer's sample hands the render-scale controller (`timing.ts`): the image's GPU busy
// time when every pass that ran was read, none when a pass's pair could not be read; and, while the
// cut has a GPU time budget, the time of its visibility passes, the fraction the image was cut at.
import test from 'node:test'
import assert from 'node:assert/strict'
import { MS, timedDevice } from '../../gpu/timing/imageTimer.fixture.ts'
import { prepareGpuTiming } from './timing.ts'
import { createWebgpuTimingState } from '../backend/state/timing.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import {
  DEFERRED_LIGHTING_PASS,
  RASTER_IDENTIFIERS_PASS,
} from '../../diagnostic/stage/passLabels.ts'

/** What the controller was handed by an image whose passes the device timed at `pairs` (ms), each
 *  labelled by `labels`: its GPU time and its edge scale's time and fraction. `edgeBudgetMs`: the
 *  budget the cut was given; `beside`, the visibility time a view drawn beside the main one cost. */
async function observed(
  pairs: [bigint, bigint][],
  labels: string[] = [],
  edgeBudgetMs = 0,
  beside = 0,
) {
  const f = timedDevice(),
    seen: (number | null)[] = [],
    edge: number[][] = []
  // The main view drawn, alone: its scale the world's controller.
  const main = {
    scale: {
      bounds: { auto: false },
      edgeBudgetMs,
      observe: (gpuMs: number | null, _scale: number, _steered: boolean, ms = 0, fraction = 0) => {
        seen.push(gpuMs)
        edge.push([ms, fraction])
      },
    },
  }
  const view = {
    every: 2,
    timing: { lastGpuFrameMs: 4, lastGpuPassMs: beside ? aside(beside) : null },
  }
  const rt = {
    timing: createWebgpuTimingState(),
    views: { main, active: main, persistent: beside ? [view] : [] },
    diag: { traceEnabled: false, engineDiagnostic() {} },
    bounce: {},
  } as unknown as WebgpuPagesRuntime
  prepareGpuTiming(rt, f.device)
  const timing = rt.timing.gpuTiming!
  const encoder = timing.createEncoder(1)
  pairs.forEach((_, i) => encoder.beginComputePass({ label: labels[i] ?? 'pass' }).end())
  encoder.finish()
  const read = new BigUint64Array(f.buffers[1].getMappedRange())
  pairs.forEach(([begin, end], i) => read.set([begin * MS, end * MS], i * 2))
  timing.submitted(encoder, { frame: 1, renderScale: 1, edgeScale: 0.5 })
  await timing.flush()
  timing.dispose()
  return { seen, edge }
}

/** The sample of an image drawn beside the main one, its visibility passes taking `ms`. */
const aside = (ms: number) => ({
  frame: 1,
  totalMs: ms,
  truncated: false,
  passes: [{ name: RASTER_IDENTIFIERS_PASS, gpuMs: ms }],
})

test('the controller reads the busy time of an image whose every pass was read', async () => {
  assert.deepEqual(
    (
      await observed([
        [1n, 3n],
        [4n, 7n],
      ])
    ).seen,
    [6],
  )
})

test('an image with a pass whose timestamps cannot be read hands no time', async () => {
  assert.deepEqual(
    (
      await observed([
        [1n, 3n],
        [4n, 0n],
      ])
    ).seen,
    [null],
  )
})

test('with a budget the controller is handed the time of the visibility passes, those beside the main view too, and the fraction the image was cut at', async () => {
  const passes: [bigint, bigint][] = [
      [1n, 3n],
      [4n, 9n],
    ],
    labels = [RASTER_IDENTIFIERS_PASS, DEFERRED_LIGHTING_PASS]
  assert.deepEqual(
    (await observed(passes, labels, 10)).edge,
    [[2, 0.5]],
    'the raster, not the lighting',
  )
  assert.deepEqual(
    (await observed(passes, labels, 10, 6)).edge,
    [[2 + 6 / 2, 0.5]],
    'a view beside, over its frames',
  )
  assert.deepEqual(
    (await observed(passes, labels, 0)).edge,
    [[Number.NaN, 0.5]],
    'no budget, no time',
  )
  assert.deepEqual(
    (await observed(passes, ['pass', 'pass'], 10)).edge,
    [[Number.NaN, 0.5]],
    'no pass of the block',
  )
})
