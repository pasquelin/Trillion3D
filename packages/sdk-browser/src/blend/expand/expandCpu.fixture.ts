import { planItem, planPipeline } from '../plan/plan.ts'
import { PLAN_PIPELINE_MASK } from '../plan/planEntry.ts'
import { instanceWord, placeBlendSlots } from '../runs.fixture.ts'
import { RUN_WORDS, slotCapacity } from '../plan/planLayout.ts'
import { sortSeedsFarToNear } from '../sortPlan.ts'
import { eyeKey } from '../eyeKey.ts'
import type { WebgpuBlendState } from '../state.ts'
import type { ViewFilter } from './expansionViews.ts'
import { hasBit } from '../../../../math/src/scalar/bits.ts'
import { NO_INDEX } from '../../../../math/src/constants.ts'

/** The cull mode the vertex stage applies to an entry's instances, read back from the pipeline the
 *  entry sets (`planPipeline`): zero when the pipeline culls. */
export const planVertexCull = (entry: number) => (entry & PLAN_PIPELINE_MASK) - planPipeline(entry)

/**
 * Everything plan expansion reads and writes, without a single GPU object: the reference SEMANTICS
 * of the `expandWgsl.ts` kernel, the oracle its proofs and the fake device replay.
 */
export type BlendExpansion = {
  /** Sorted plan, farthest to nearest, and the runs of its slots (`../runs.fixture.ts`). */
  order: Uint32Array
  runs: Uint32Array
  runCount: number
  /** Four words per item: table rank (`NO_INDEX` for one the table does not hold yet), instances
   *  it can expand at most, table base, and its filter word (`../expand/expansionViews.ts`). */
  draws: Uint32Array
  /** One bit per item: zero for the item the frustum rejects, which expands no instance. */
  keep: Uint32Array
  /** Instances compaction kept per item, and its entry list. */
  itemCounts: Uint32Array
  instances: Uint32Array
  /** Vertices of a cluster, and the instance addressing stride. */
  maxVertexWords: number
  vertexShift: number
  /** Where the pass expands its instances, and where it writes its arguments: two regions per pass. */
  instanceBase: number
  argsBase: number
  /** The view's filter (`ViewFilter`): an item with a bit of `exclude` in its word, or without every bit of `require`, expands nothing.
   *  The view of every layer by default. */
  filter?: ViewFilter
  /** Outputs: two words per instance, four indirect-argument words per run. */
  expanded: Uint32Array
  args: Uint32Array
}

/**
 * Expands the sorted plan into an instance list and one indirect argument per run; a run of no
 * entry, an empty slot, draws no instance.
 *
 * An instance says two things: the item that carries it — with the cull mode its vertex stage
 * applies (`instanceWord`) — and what it draws — the table entry of a cluster. The list follows
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
    // Every run draws clusters, at the table stride.
    for (let k = 0; k < entries; k++) {
      const entry = order[first + k],
        item = planItem(entry)
      if (!hasBit(keep, item)) continue
      const word = instanceWord(item, planVertexCull(entry))
      const paged = draws[item * 4]
      if (paged === NO_INDEX) continue
      // The view's filter, read here as its definition says: no bit it excludes, every bit it
      // requires.
      const filter = draws[item * 4 + 3]
      if (
        x.filter &&
        ((filter & x.filter.exclude) !== 0 || (filter & x.filter.require) !== x.filter.require)
      )
        continue
      const tableBase = draws[item * 4 + 2],
        tenues = itemCounts[paged]
      for (let j = 0; j < tenues; j++) {
        expanded[cursor * 2] = word
        expanded[cursor * 2 + 1] = instances[tableBase + j]
        cursor++
      }
    }
    args[out] = x.maxVertexWords
    args[out + 1] = cursor - base
    args[out + 2] = base << x.vertexShift
    args[out + 3] = 0
  }
  return cursor - x.instanceBase
}

/** The eye the frame data holds: what the CPU model ranks from. */
export const orderEye = (blendState: WebgpuBlendState) => blendState.frameDoubles.subarray(0, 3)

/** Copies every item's key into the flat array the CPU model ranks from (`orderKeys`), its source
 *  rank — its index — breaking equal keys. */
export function refreshEyeKeys(blendState: WebgpuBlendState, eye: ArrayLike<number>) {
  const items = blendState.blendGpu,
    ex = eye[0],
    ey = eye[1],
    ez = eye[2]
  if (blendState.orderKeys.length < items.length)
    blendState.orderKeys = new Float64Array(items.length)
  const keys = blendState.orderKeys
  for (let i = 0; i < items.length; i++) keys[i] = eyeKey(items[i], ex, ey, ez)
}

/** The CPU model's own tables per scene, never the engine's: the pass's paint order (seed
 *  indices, kept from frame to frame as the GPU's) and its slot runs. */
const models = new WeakMap<WebgpuBlendState, { order: Uint32Array; runs: Uint32Array }>()

/** The CPU model of `blendState`: its tables, sized by the plan. */
export function cpuModel(blendState: WebgpuBlendState) {
  const words = slotCapacity(blendState.maxPlanEntries) * RUN_WORDS
  let model = models.get(blendState)
  if (!model || model.runs.length !== words) {
    model = { order: new Uint32Array(0), runs: new Uint32Array(words) }
    models.set(blendState, model)
  }
  return model
}

/** Scratch of the CPU model's order: sorted entries and each seed's place, grown with the plan. */
let sortedEntries = new Uint32Array(0),
  placed = new Uint32Array(0)

/**
 * THE CPU MODEL OF THE ORDER KERNEL (`../order/orderWgsl.ts`): every entry of the pass ranked by the same
 * keys and rule, its runs placed as `placeBlendSlots` places them. Returns the sorted entries; the
 * runs land in `cpuModel(blendState).runs`. `orderKeys` must hold every item's key.
 */
export function orderBlendPlanCpu(blendState: WebgpuBlendState) {
  const seeds = blendState.seeds,
    n = seeds.length,
    model = cpuModel(blendState)
  let order = model.order
  if (order.length !== n) order = model.order = Uint32Array.from(seeds.keys())
  sortSeedsFarToNear(order, seeds, blendState.orderKeys, blendState.orderPriorities)
  if (sortedEntries.length < n) {
    sortedEntries = new Uint32Array(n)
    placed = new Uint32Array(n)
  }
  for (let i = 0; i < n; i++) {
    sortedEntries[i] = seeds[order[i]]
    placed[order[i]] = i
  }
  placeBlendSlots(
    model.runs,
    placed,
    { seeds: blendState.ownSeeds, slots: blendState.ownSlots },
    n,
    blendState.mainPipeline >= 0,
  )
  return sortedEntries.subarray(0, n)
}
