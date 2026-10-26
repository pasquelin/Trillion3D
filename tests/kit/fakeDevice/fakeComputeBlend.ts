// The transparent kernels a fake device runs: compaction of the paged items, the frustum verdict
// and the paint order through their shipped WGSL (`shaderRun`), dispatch by dispatch; expansion of
// the sorted plan through its oracle (`expandCpu.fixture.ts`), at its last dispatch — its packet
// count and running sum scan each workgroup in workgroup memory with a barrier inside the scan's
// loop (`laneScan`), which a run of one thread after the other cannot interleave. The compaction's
// count and scatter call the scan once, its value known before and only the lane's own prefix read
// after: the lanes of a workgroup run in order, the scan their running sum.
import { shaderRun } from '../../../packages/sdk-browser/src/materials/texture/shaderRun.fixture.ts'
import { TRANSPARENT_COMPACT_SHADER } from '../../../packages/sdk-browser/src/blend/transparent/shader.ts'
import { expandBlendPlan } from '../../../packages/sdk-browser/src/blend/expand/expandCpu.fixture.ts'
import { RUN_WORDS } from '../../../packages/sdk-browser/src/blend/plan/planLayout.ts'
import { EXPAND_UNI } from '../../../packages/sdk-browser/src/blend/expand/expandUniform.ts'
import { EXPAND_BINDING } from '../../../packages/sdk-browser/src/blend/expand/expandBindings.ts'
import {
  ORDER_BINDING,
  ORDER_UNI,
} from '../../../packages/sdk-browser/src/blend/order/orderWgsl.ts'
import {
  orderKernelOf,
  runOrderDispatch,
} from '../../../packages/sdk-browser/src/blend/order/orderRun.fixture.ts'
import { runVerdict } from '../../../packages/sdk-browser/src/blend/verdict/verdictRun.fixture.ts'
import { VERDICT_BINDING } from '../../../packages/sdk-browser/src/blend/verdict/verdictWgsl.ts'
import type { ComputeBind } from './fakeCompute.ts'
import { boundWords, vectors } from './fakeBuffers.ts'
import { WORKGROUP_THREADS } from '../../../packages/sdk-browser/src/gpu/dispatch/grid.ts'

/** The compaction's three entry points. */
const COMPACT_ENTRIES = [
  'countTransparentGroups',
  'prefixTransparentItems',
  'scatterTransparentGroups',
]

/** Runs a dispatch of the transparent compaction (`TRANSPARENT_COMPACT_SHADER`): its shipped WGSL
 *  over the words the dispatch binds, every thread of the `groups` × `rows` workgroups the host
 *  dispatched, the shader's own bound leaving those past its count — a host that sizes a dispatch
 *  short leaves work undone here too. The count and the scatter run a workgroup's lanes in order,
 *  the engine's lane scan (`../../../packages/sdk-browser/src/gpu/core/laneScanWgsl.ts`) their
 *  running sum, restarted each workgroup. */
function simulateTransparentCompaction(
  bind: ComputeBind,
  entry: string,
  groups: number | undefined,
  rows = 1,
) {
  if (groups === undefined) throw new Error('the transparent compaction is dispatched direct')
  const at = (binding: number) => boundWords(bind.entries, binding)
  const words = at(1)
  const uni = {
    entryCount: words[0],
    groupCount: words[1],
    itemCount: words[2],
    selectionOffset: words[3],
    vertexCount: words[4],
  }
  const laneSums: number[] = []
  const kernel = shaderRun<Record<string, (id: number[], n: number[], lane?: number) => void>>(
    TRANSPARENT_COMPACT_SHADER,
    [entry, 'keptInGroup', 'selected', 'maskSelects', 'flatIndex'],
    {
      laneScan: (lane: number, value: number) =>
        (laneSums[lane] = ((lane > 0 ? laneSums[lane - 1] : 0) + value) >>> 0),
      entries: at(0),
      uni,
      selectionMask: at(2),
      groupCounts: at(3),
      groupOffsets: at(4),
      instances: at(5),
      indirect: at(6),
      itemRanges: at(7),
      occluded: at(8),
    },
  )
  const n = [groups, rows, 1]
  if (entry === 'prefixTransparentItems') {
    const width = groups * WORKGROUP_THREADS
    for (let i = 0; i < width * rows; i++) kernel[entry]([i % width, Math.floor(i / width), 0], n)
    return
  }
  for (let wg = 0; wg < groups * rows; wg++)
    for (let lane = 0; lane < WORKGROUP_THREADS; lane++)
      kernel[entry]([wg % groups, Math.floor(wg / groups), 0], n, lane)
}

/**
 * Replays expansion of the sorted plan: the oracle of `BLEND_EXPAND_SHADER`
 * (`blend/expand/expandCpu.fixture.ts`). The double replays it at the last of the four kernels,
 * when every input the GPU would read is there.
 */
function simulateBlendExpansion(bind: ComputeBind, offsets?: readonly number[]) {
  const uni = boundWords(bind.entries, EXPAND_BINDING.uni).subarray((offsets?.[0] ?? 0) / 4)
  const plan = boundWords(bind.entries, EXPAND_BINDING.plan)
  // Compaction writes one indirect argument per paged item; expansion reads only the count.
  const indirect = boundWords(bind.entries, EXPAND_BINDING.counts)
  const itemCounts = new Uint32Array(indirect.length / 4)
  for (let item = 0; item < itemCounts.length; item++) itemCounts[item] = indirect[item * 4 + 1]
  const entries = uni[EXPAND_UNI.entryCount],
    runs = uni[EXPAND_UNI.runCount]
  expandBlendPlan({
    order: plan.subarray(uni[EXPAND_UNI.orderBase], uni[EXPAND_UNI.orderBase] + entries),
    runs: plan.subarray(uni[EXPAND_UNI.runsBase], uni[EXPAND_UNI.runsBase] + runs * RUN_WORDS),
    runCount: runs,
    draws: boundWords(bind.entries, EXPAND_BINDING.draws),
    keep: boundWords(bind.entries, EXPAND_BINDING.keep),
    itemCounts,
    instances: boundWords(bind.entries, EXPAND_BINDING.clusters),
    maxVertexWords: uni[EXPAND_UNI.maxVertexWords],
    vertexShift: uni[EXPAND_UNI.vertexShift],
    instanceBase: uni[EXPAND_UNI.instanceBase],
    argsBase: uni[EXPAND_UNI.argsBase],
    filter: { exclude: uni[EXPAND_UNI.exclude], require: uni[EXPAND_UNI.required] },
    expanded: boundWords(bind.entries, EXPAND_BINDING.expanded),
    args: boundWords(bind.entries, EXPAND_BINDING.args),
  })
}

/** Runs a dispatch of the paint order (`BLEND_ORDER_SHADER`), entry point `entry` of
 *  `BLEND_ORDER_ENTRIES` (its rank): its shipped WGSL (`runOrderDispatch`) over the words the
 *  dispatch binds, under the uniform at its dynamic offset, at the `groups` workgroups the host
 *  dispatched — a host that sizes a dispatch wrong runs wrong here too. */
function simulateBlendOrder(
  bind: ComputeBind,
  offsets: readonly number[] | undefined,
  entry: number,
  groups: number | undefined,
) {
  if (groups === undefined) throw new Error('the paint order is dispatched direct')
  const at = (binding: number) => boundWords(bind.entries, binding)
  const words = at(ORDER_BINDING.uni).subarray((offsets?.[0] ?? 0) / 4)
  const uni: Record<string, number> = {}
  for (const [name, rank] of Object.entries(ORDER_UNI)) uni[name] = words[rank]
  const scope = {
    uni,
    plan: at(ORDER_BINDING.plan),
    keyed: at(ORDER_BINDING.keyed),
    frame: at(ORDER_BINDING.frame),
    sorted: vectors(4, at(ORDER_BINDING.sorted)),
    placed: at(ORDER_BINDING.placed),
    held: [] as number[][],
  }
  runOrderDispatch(orderKernelOf(scope), scope, entry, groups)
}

/** Runs the frustum verdict (`judgeBlendItems`): its shipped WGSL (`runVerdict`) over the words
 *  the dispatch binds, every workgroup the frame's item count asks. */
function simulateBlendVerdict(bind: ComputeBind) {
  const at = (binding: number) => boundWords(bind.entries, binding)
  runVerdict({
    keyed: at(VERDICT_BINDING.keyed),
    draws: at(VERDICT_BINDING.draws),
    counts: at(VERDICT_BINDING.counts),
    frame: at(VERDICT_BINDING.frame),
    keep: at(VERDICT_BINDING.keep),
    verdict: at(VERDICT_BINDING.verdict),
  })
}

/** The transparent kernels the double runs, by entry point: every dispatch of the compaction, the
 *  verdict and the order — the compaction and the order at the workgroups its dispatch asked —;
 *  the expansion's last, once everything it reads is there. */
export const TRANSPARENT_STAGES: Record<
  string,
  | ((bind: ComputeBind, offsets?: readonly number[], groups?: number, rows?: number) => void)
  | undefined
> = {
  judgeBlendItems: simulateBlendVerdict,
  sortBlendBlocks: (bind, offsets, groups) => simulateBlendOrder(bind, offsets, 0, groups),
  sortBlendStep: (bind, offsets, groups) => simulateBlendOrder(bind, offsets, 1, groups),
  placeBlendSlots: (bind, offsets, groups) => simulateBlendOrder(bind, offsets, 2, groups),
  writeBlendRuns: simulateBlendExpansion,
}
for (const entry of COMPACT_ENTRIES)
  TRANSPARENT_STAGES[entry] = (bind, _offsets, groups, rows) =>
    simulateTransparentCompaction(bind, entry, groups, rows)
