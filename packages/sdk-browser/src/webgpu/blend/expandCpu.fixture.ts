import { DRAW_UNPAGED, planItem, planPipeline } from './plan.ts'
import { PLAN_PIPELINE_MASK } from './planEntry.ts'
import { itemKept } from './hierarchyCull.ts'
import { instanceWord, placeBlendSlots } from './runs.fixture.ts'
import { RUN_WORDS, slotCapacity } from './planLayout.ts'
import { sortSeedsFarToNear } from './sortPlan.ts'
import { eyeKey } from './eyeKey.ts'
import type { createWebgpuBlendState } from './state.ts'
type BlendState = ReturnType<typeof createWebgpuBlendState>

/** The cull mode the vertex stage applies to an entry's instances, read back from the pipeline the
 *  entry sets (`planPipeline`): zero when the pipeline culls. */
export const planVertexCull = (entry: number) => (entry & PLAN_PIPELINE_MASK) - planPipeline(entry)

/**
 * Everything plan expansion reads and writes, without a single GPU object: the reference SEMANTICS
 * of the `expandWgsl.ts` kernel, the oracle its proofs and the fake device replay.
 */
export type BlendExpansion = {
  /** Sorted plan, farthest to nearest, and the runs of its slots (`runs.fixture.ts`). */
  order: Uint32Array
  runs: Uint32Array
  runCount: number
  /** Four words per item: paged rank, static instances, table base, vertices per instance. */
  draws: Uint32Array
  /** One bit per item: zero for the item the frustum rejects, which expands no instance. */
  keep: Uint32Array
  /** Instances compaction kept per paged item, and its entry list. */
  itemCounts: Uint32Array
  instances: Uint32Array
  /** Vertices of a paged cluster, and the instance addressing stride. */
  maxVertexWords: number
  vertexShift: number
  /** Where the pass expands its instances, and where it writes its arguments: two regions per pass. */
  instanceBase: number
  argsBase: number
  /** Outputs: two words per instance, four indirect-argument words per run. */
  expanded: Uint32Array
  args: Uint32Array
}

/**
 * Expands the sorted plan into an instance list and one indirect argument per run; a run of no
 * entry, an empty slot, draws no instance.
 *
 * An instance says two things: the item that carries it — with the cull mode its vertex stage
 * applies (`instanceWord`) — and what it draws — the table entry of
 * a paged cluster, the first index of its chunk for a primitive that is not. The list follows
 * plan order, hence paint order, and a run's draw starts at vertex `base << vertexShift` so the
 * shader finds the rank of its first instance there.
 *
 * Returns the number of instances written.
 */
export function expandBlendPlan(x: BlendExpansion) {
  const { order, runs, draws, keep, itemCounts, instances, expanded, args } = x
  let cursor = x.instanceBase
  for (let run = 0; run < x.runCount; run++) {
    const at = run * RUN_WORDS,
      first = runs[at],
      entries = runs[at + 1],
      out = x.argsBase + run * 4,
      base = cursor
    if (!entries) {
      args[out] = x.maxVertexWords
      args[out + 1] = args[out + 2] = args[out + 3] = 0
      continue
    }
    // A run of several entries draws shared clusters, all at the table stride; a run of a single
    // unpaged item draws its chunks, at the stride its geometry gave it.
    const owner = planItem(order[first])
    const vertexCount =
      entries === 1 && draws[owner * 4] === DRAW_UNPAGED ? draws[owner * 4 + 3] : x.maxVertexWords
    for (let k = 0; k < entries; k++) {
      const entry = order[first + k],
        item = planItem(entry)
      if (!itemKept(keep, item)) continue
      const word = instanceWord(item, planVertexCull(entry))
      const paged = draws[item * 4]
      if (paged === DRAW_UNPAGED) {
        const words = draws[item * 4 + 3],
          chunks = draws[item * 4 + 1]
        for (let j = 0; j < chunks; j++) {
          expanded[cursor * 2] = word
          expanded[cursor * 2 + 1] = j * words
          cursor++
        }
        continue
      }
      const tableBase = draws[item * 4 + 2],
        tenues = itemCounts[paged]
      for (let j = 0; j < tenues; j++) {
        expanded[cursor * 2] = word
        expanded[cursor * 2 + 1] = instances[tableBase + j]
        cursor++
      }
    }
    args[out] = vertexCount
    args[out + 1] = cursor - base
    args[out + 2] = base << x.vertexShift
    args[out + 3] = 0
  }
  return cursor - x.instanceBase
}

/** The eye the frame data holds: what the CPU model ranks from. */
export const orderEye = (blendState: BlendState) => blendState.frameDoubles.subarray(0, 3)

/** Copies every item's key into the flat array the CPU model ranks from (`orderKeys`), its source
 *  rank — its index — breaking equal keys. */
export function refreshEyeKeys(blendState: BlendState, eye: ArrayLike<number>) {
  const items = blendState.blendGpu,
    ex = eye[0],
    ey = eye[1],
    ez = eye[2]
  if (blendState.orderKeys.length < items.length)
    blendState.orderKeys = new Float64Array(items.length)
  const keys = blendState.orderKeys
  for (let i = 0; i < items.length; i++) keys[i] = eyeKey(items[i], ex, ey, ez)
}

/** The CPU model's own tables per scene, never the engine's: each pass's paint order (seed
 *  indices, kept from frame to frame as the GPU's) and its slot runs. */
const models = new WeakMap<BlendState, { orders: Uint32Array[]; runs: Uint32Array[] }>()

/** The CPU model of `blendState`: its tables, sized by the plan. */
export function cpuModel(blendState: BlendState) {
  const words = slotCapacity(blendState.maxPlanEntries) * RUN_WORDS
  let model = models.get(blendState)
  if (!model || model.runs[0].length !== words) {
    model = {
      orders: [new Uint32Array(0), new Uint32Array(0)],
      runs: [new Uint32Array(words), new Uint32Array(words)],
    }
    models.set(blendState, model)
  }
  return model
}

/** Scratch of the CPU model's order: sorted entries and each seed's place, grown with the plan. */
let sortedEntries = new Uint32Array(0),
  placed = new Uint32Array(0)

/**
 * THE CPU MODEL OF THE ORDER KERNEL (`orderWgsl.ts`): every entry of the pass ranked by the same
 * keys and rule, its runs placed as `placeBlendSlots` places them. Returns the sorted entries; the
 * runs land in `cpuModel(blendState).runs[pass]`. `orderKeys` must hold every item's key.
 */
export function orderBlendPlanCpu(blendState: BlendState, pass: number) {
  const seeds = blendState.seeds[pass],
    n = seeds.length,
    model = cpuModel(blendState)
  let order = model.orders[pass]
  if (order.length !== n) order = model.orders[pass] = Uint32Array.from(seeds.keys())
  sortSeedsFarToNear(order, seeds, blendState.orderKeys)
  if (sortedEntries.length < n) {
    sortedEntries = new Uint32Array(n)
    placed = new Uint32Array(n)
  }
  for (let i = 0; i < n; i++) {
    sortedEntries[i] = seeds[order[i]]
    placed[order[i]] = i
  }
  placeBlendSlots(
    model.runs[pass],
    placed,
    { seeds: blendState.ownSeeds[pass], slots: blendState.ownSlots[pass] },
    n,
    blendState.mainPipeline[pass] >= 0,
  )
  return sortedEntries.subarray(0, n)
}
