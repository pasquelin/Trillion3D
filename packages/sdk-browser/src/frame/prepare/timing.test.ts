// What the timer's sample hands the render-scale controller (`timing.ts`): the dynamic resolution's
// settings now, the image's GPU busy time when every pass that ran was read, none when a pass's pair
// could not be read, the views drawn beside the main one included; and, while the cut has a GPU
// time budget, the time of the main view's visibility passes, and, while the shadows name one, the time
// of the shadow raster's.
import test from 'node:test'
import assert from 'node:assert/strict'
import { MS, timedDevice } from '../../gpu/timing/imageTimer.fixture.ts'
import { prepareGpuTiming } from './timing.ts'
import { createWebgpuTimingState } from '../backend/state/timing.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import {
  SURFACE_COLOUR_PASS,
  RASTER_IDENTIFIERS_PASS,
  VSM_PASS_PREFIX,
} from '../../diagnostic/stage/passLabels.ts'
import { NO_TIMING } from '../scale/dynamicResolution.ts'

/** What the controller was handed by an image whose passes the device timed at `pairs` (ms), each
 *  labelled by `labels`: its GPU time and its edge scale's time. `edgeBudgetMs`: the budget the cut
 *  was given; `beside`, the GPU time a view drawn beside the main one cost; `context`, the settings
 *  of the session. */
async function observed(
  pairs: [bigint, bigint][],
  labels: string[] = [],
  edgeBudgetMs = 0,
  beside = 0,
  context: object = {},
  vsmBudgetMs = 0,
) {
  const f = timedDevice(),
    seen: (number | null)[] = [],
    edge: number[] = [],
    vsm: number[] = [],
    rules: Record<string, unknown> = {}
  // The main view drawn, alone: its scale the world's controller.
  const main = {
    scale: {
      bounds: { auto: false },
      edge: { budgetMs: edgeBudgetMs },
      vsm: { budgetMs: vsmBudgetMs },
      rules,
      observe: (
        gpuMs: number | null,
        _scale: number,
        _steered: boolean,
        edgeMs: number,
        vsmMs: number,
      ) => {
        seen.push(gpuMs)
        edge.push(edgeMs)
        vsm.push(vsmMs)
      },
    },
  }
  const view = { every: 2, timing: { lastGpuFrameMs: beside } }
  const rt = {
    timing: createWebgpuTimingState(),
    views: { main, active: main, persistent: beside ? [view] : [] },
    diag: { traceEnabled: false, engineDiagnostic() {} },
    bounce: {},
    context,
  } as unknown as WebgpuPagesRuntime
  prepareGpuTiming(rt, f.device)
  const timing = rt.timing.gpuTiming!
  const encoder = timing.createEncoder(1)
  pairs.forEach((_, i) => encoder.beginComputePass({ label: labels[i] ?? 'pass' }).end())
  encoder.finish()
  const read = new BigUint64Array(f.buffers[1].getMappedRange())
  pairs.forEach(([begin, end], i) => read.set([begin * MS, end * MS], i * 2))
  timing.submitted(encoder, { frame: 1, renderScale: 1 })
  await timing.flush()
  timing.dispose()
  return { seen, edge, vsm, rules }
}

const TWO_PASSES: [bigint, bigint][] = [
  [1n, 3n],
  [4n, 9n],
]

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

test('the controller is handed the views drawn beside the main one in the busy time, over their frames', async () => {
  const { seen } = await observed(TWO_PASSES, [], 0, 6)
  assert.deepEqual(
    seen,
    [8 + 6 / 2],
    "the submission's span, 1 to 9 ms, and a view's image over its frames",
  )
})

test('with a budget the controller is handed the time of the main view’s visibility passes alone, none without', async () => {
  const labels = [RASTER_IDENTIFIERS_PASS, SURFACE_COLOUR_PASS]
  assert.deepEqual(
    (await observed(TWO_PASSES, labels, 10)).edge,
    [2],
    'the raster, not the lighting',
  )
  assert.deepEqual((await observed(TWO_PASSES, labels, 10, 6)).edge, [2], 'no view beside')
  assert.deepEqual((await observed(TWO_PASSES, labels, 0)).edge, [NO_TIMING], 'no budget')
  assert.deepEqual((await observed(TWO_PASSES, [], 10)).edge, [NO_TIMING], 'no pass of the block')
})

test('with a shadow time budget the controller is handed the time of the shadow raster’s passes, none without', async () => {
  const labels = [`${VSM_PASS_PREFIX}render.cull 0`, SURFACE_COLOUR_PASS]
  assert.deepEqual((await observed(TWO_PASSES, labels, 0, 0, {}, 4)).vsm, [2], 'the raster alone')
  assert.deepEqual((await observed(TWO_PASSES, labels)).vsm, [NO_TIMING], 'no budget')
  assert.deepEqual(
    (await observed(TWO_PASSES, [], 0, 0, {}, 4)).vsm,
    [0],
    'a frame that ran none: the raster cost nothing',
  )
})

test('each sample resolves the dynamic resolution’s settings of the session into the controller’s', async () => {
  const { rules } = await observed(TWO_PASSES, [], 0, 0, { dynamicResolutionHistorySize: 4 })
  assert.equal(rules.dynamicResolutionHistorySize, 4, 'the session’s')
  assert.equal(rules.dynamicResolutionHeadroomPercent, 10, 'the reference’s default for the rest')
})
