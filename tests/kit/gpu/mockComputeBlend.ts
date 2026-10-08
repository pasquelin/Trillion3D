// The transparent kernels a fake device replays: compaction of the paged items, the paint order,
// then expansion of the sorted plan, each through the CPU oracle the shader implements.
import { evaluateTransparentCompaction } from '../../../packages/sdk-browser/src/webgpu/transparent/compactCpu.fixture.ts'
import { expandBlendPlan } from '../../../packages/sdk-browser/src/webgpu/blend/expandCpu.fixture.ts'
import { RUN_WORDS } from '../../../packages/sdk-browser/src/webgpu/blend/planLayout.ts'
import { EXPAND_UNI } from '../../../packages/sdk-browser/src/webgpu/blend/expandUniform.ts'
import { EXPAND_BINDING } from '../../../packages/sdk-browser/src/webgpu/blend/expandBindings.ts'
import {
  KEY_HAS_BOX,
  KEY_RECORD_WORDS,
  NOT_OWN,
  ORDER_BINDING,
  ORDER_UNI,
} from '../../../packages/sdk-browser/src/webgpu/blend/orderWgsl.ts'
import { PLAN_SHIFT } from '../../../packages/sdk-browser/src/webgpu/blend/planEntry.ts'
import { placeBlendSlots } from '../../../packages/sdk-browser/src/webgpu/blend/runs.fixture.ts'
import { precedes } from '../../../packages/sdk-browser/src/webgpu/blend/paintOrder.ts'
import { boxCenterFrom } from '../../../packages/math/src/geometry/box.ts'
import type { ComputeBind } from './mockCompute.ts'
import { words } from './mockBuffers.ts'

/** Replays the transparent compaction: the same oracle the shader implements. */
function simulateTransparentCompaction(bind: ComputeBind) {
  const byBinding = new Map(bind.entries.map((entry) => [entry.binding, entry.resource.buffer]))
  const uni = words(byBinding.get(1)!.data)
  const mask = words(byBinding.get(2)!.data)
  const result = evaluateTransparentCompaction({
    entries: words(byBinding.get(0)!.data),
    itemRanges: words(byBinding.get(7)!.data),
    entryCount: uni[0],
    itemCount: uni[2],
    vertexCount: uni[4],
    selected: (cluster) => mask[uni[3] + cluster] !== 0,
  })
  words(byBinding.get(5)!.data).set(result.instances.subarray(0, uni[0]))
  words(byBinding.get(6)!.data).set(result.indirect)
}

/**
 * Replays expansion of the sorted plan: the oracle of `BLEND_EXPAND_SHADER`
 * (`webgpu/blend/expandCpu.fixture.ts`). The double replays it at the last of the four kernels, when
 * every input the GPU would read is there.
 */
function simulateBlendExpansion(bind: ComputeBind, offsets?: readonly number[]) {
  const byBinding = new Map(bind.entries.map((entry) => [entry.binding, entry.resource.buffer]))
  const uniBytes = byBinding.get(EXPAND_BINDING.uni)!.data
  const uni = words(uniBytes).subarray((offsets?.[0] ?? 0) / 4)
  const plan = words(byBinding.get(EXPAND_BINDING.plan)!.data)
  // Compaction writes one indirect argument per paged item; expansion reads only the count.
  const indirect = words(byBinding.get(EXPAND_BINDING.counts)!.data)
  const itemCounts = new Uint32Array(indirect.length / 4)
  for (let item = 0; item < itemCounts.length; item++) itemCounts[item] = indirect[item * 4 + 1]
  const entries = uni[EXPAND_UNI.entryCount],
    runs = uni[EXPAND_UNI.runCount]
  expandBlendPlan({
    order: plan.subarray(uni[EXPAND_UNI.orderBase], uni[EXPAND_UNI.orderBase] + entries),
    runs: plan.subarray(uni[EXPAND_UNI.runsBase], uni[EXPAND_UNI.runsBase] + runs * RUN_WORDS),
    runCount: runs,
    draws: words(byBinding.get(EXPAND_BINDING.draws)!.data),
    keep: words(byBinding.get(EXPAND_BINDING.keep)!.data),
    itemCounts,
    instances: words(byBinding.get(EXPAND_BINDING.clusters)!.data),
    maxVertexWords: uni[EXPAND_UNI.maxVertexWords],
    vertexShift: uni[EXPAND_UNI.vertexShift],
    instanceBase: uni[EXPAND_UNI.instanceBase],
    argsBase: uni[EXPAND_UNI.argsBase],
    expanded: words(byBinding.get(EXPAND_BINDING.expanded)!.data),
    args: words(byBinding.get(EXPAND_BINDING.args)!.data),
  })
}

const cell = new Float64Array(1),
  cellWords = new Uint32Array(cell.buffer)
/** The double whose bits sit at `at`, low word first: the GPU's NaN, all ones, reads as a NaN. */
const doubleAt = (source: Uint32Array, at: number) => (
  (cellWords[0] = source[at]),
  (cellWords[1] = source[at + 1]),
  cell[0]
)
/** A key record's box, then its centre (or its origin) relative to the eye. */
const keyBox = new Float64Array(6),
  keyGap = new Float64Array(3)

/**
 * Replays the order of one pass at its last dispatch (`placeBlendSlots`), when the plan, key
 * records and frame data it reads are there: every seed keyed as `itemKey` keys it — the CPU's
 * doubles, which the kernel's emulated ones equal to the bit (`orderWgsl.test.ts`) —, ranked by
 * `precedes`, its sorted entries, places and slot runs written where the kernel writes them.
 */
function simulateBlendOrder(bind: ComputeBind, offsets?: readonly number[]) {
  const byBinding = new Map(bind.entries.map((entry) => [entry.binding, entry.resource.buffer]))
  const uni = words(byBinding.get(ORDER_BINDING.uni)!.data).subarray((offsets?.[0] ?? 0) / 4)
  const plan = words(byBinding.get(ORDER_BINDING.plan)!.data),
    keyed = words(byBinding.get(ORDER_BINDING.keyed)!.data),
    frame = words(byBinding.get(ORDER_BINDING.frame)!.data),
    placed = words(byBinding.get(ORDER_BINDING.placed)!.data)
  const entries = uni[ORDER_UNI.entryCount],
    seeds = plan.subarray(uni[ORDER_UNI.seedBase], uni[ORDER_UNI.seedBase] + entries)
  const eye = [0, 2, 4].map((at) => doubleAt(frame, at))
  const keyOf = (seed: number) => {
    const at = (seeds[seed] >>> PLAN_SHIFT) * KEY_RECORD_WORDS,
      own = keyed[at + 13]
    if (own !== NOT_OWN) return doubleAt(frame, uni[ORDER_UNI.ownKeyBase] + own * 2)
    const box = (keyed[at + 12] & KEY_HAS_BOX) !== 0
    for (let i = 0; i < (box ? 6 : 3); i++) keyBox[i] = doubleAt(keyed, at + i * 2)
    if (box) boxCenterFrom(keyGap, 0, keyBox, 0, eye[0], eye[1], eye[2])
    else for (let axis = 0; axis < 3; axis++) keyGap[axis] = keyBox[axis] - eye[axis]
    let key = 0
    for (const gap of keyGap) key += gap * gap
    return key
  }
  const keys = Array.from(seeds, (_, seed) => keyOf(seed))
  const order = Array.from(seeds.keys()).sort((a, b) =>
    precedes(keys[a], a, keys[b], b) ? 1 : precedes(keys[b], b, keys[a], a) ? -1 : 0,
  )
  order.forEach((seed, at) => {
    plan[uni[ORDER_UNI.orderBase] + at] = seeds[seed]
    placed[seed] = at
  })
  const own = (base: number) => frame.subarray(uni[base], uni[base] + uni[ORDER_UNI.ownCount])
  placeBlendSlots(
    plan.subarray(uni[ORDER_UNI.runsBase]),
    placed,
    { seeds: own(ORDER_UNI.ownSeedBase), slots: own(ORDER_UNI.ownSlotBase) },
    entries,
    uni[ORDER_UNI.gaps] !== 0,
  )
}

/** The transparent kernels the double replays, by the entry point of their last dispatch: each
 *  replay runs once everything that kernel reads is there. */
export const TRANSPARENT_STAGES: Record<
  string,
  ((bind: ComputeBind, offsets?: readonly number[]) => void) | undefined
> = {
  scatterTransparentGroups: simulateTransparentCompaction,
  placeBlendSlots: simulateBlendOrder,
  writeBlendRuns: simulateBlendExpansion,
}
