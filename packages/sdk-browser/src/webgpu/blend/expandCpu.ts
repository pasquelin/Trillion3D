import { DRAW_UNPAGED, planItem, planVertexCull } from './plan.ts'
import { instanceWord, placeBlendSlots } from './runs.ts'
import { EXPAND_PASSES, RUN_WORDS, slotCapacity } from './planLayout.ts'
import { orderEye, refreshEyeKeys } from './order.ts'
import { sortSeedsFarToNear } from './sortPlan.ts'
import type { createWebgpuBlendState } from './state.ts'
type BlendState = ReturnType<typeof createWebgpuBlendState>

/**
 * Everything plan expansion reads and writes, without a single GPU object: that is the reference
 * SEMANTICS of the `expandWgsl.ts` kernel, and it is also the path a device without a
 * compute stage takes, as-is.
 */
export type BlendExpansion = {
  /** Sorted plan, farthest to nearest, and the runs of its slots (`runs.ts`). */
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

/** Did the frustum keep this item? One bit per item, written by the frame's ranking. */
export const itemKept = (keep: Uint32Array, item: number) =>
  (keep[item >>> 5] & (1 << (item & 31))) !== 0

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

/** Scratch of the CPU model's order: sorted entries and each seed's place, grown with the plan. */
let sortedEntries = new Uint32Array(0),
  placed = new Uint32Array(0)

/**
 * THE CPU MODEL OF THE ORDER KERNEL (`orderWgsl.ts`): every entry of the pass ranked by the same
 * keys and rule, its runs placed as `placeBlendSlots` places them. Returns the sorted entries; the
 * runs land in `blendState.runs[pass]`. `orderKeys` must hold every item's key.
 */
export function orderBlendPlanCpu(blendState: BlendState, pass: number) {
  const seeds = blendState.seeds[pass],
    n = seeds.length
  let order = blendState.paintOrders[pass]
  if (order.length !== n) order = blendState.paintOrders[pass] = Uint32Array.from(seeds.keys())
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
    blendState.runs[pass],
    placed,
    { seeds: blendState.ownSeeds[pass], slots: blendState.ownSlots[pass] },
    n,
    blendState.mainPipeline[pass] >= 0,
  )
  return sortedEntries.subarray(0, n)
}

/**
 * Fallback of a device without a compute stage: the SAME semantics, written by the CPU — the
 * order and its runs (`orderBlendPlanCpu`), then the expansion.
 *
 * The CPU cut has already filled the instance list and the per-item counts (`selection.ts`); all
 * that remains is to order and expand both passes' plans and push the two written regions. An item
 * the frustum rejects writes nothing there, exactly as on the GPU. It is the reference the kernels
 * are proven against, and the path of a device whose compute stage is missing or refused its
 * kernels: every key is computed here, every frame.
 */
export function writeBlendExpansionCpu(blendState: BlendState, device: GPUDevice) {
  const { expandedBuffer, argsBuffer } = blendState
  if (!expandedBuffer || !argsBuffer || !blendState.runCount.some(Boolean)) return
  // The two CPU mirrors exist ONLY on this path: a device with a compute stage does not keep in
  // host memory an instance list the GPU writes on its own.
  if (blendState.expandedPacked.length < blendState.instanceCapacity * 2)
    blendState.expandedPacked = new Uint32Array(blendState.instanceCapacity * 2)
  const argsWords = EXPAND_PASSES * slotCapacity(blendState.maxPlanEntries) * 4
  if (blendState.argsPacked.length < argsWords) blendState.argsPacked = new Uint32Array(argsWords)
  const { expandedPacked, argsPacked } = blendState
  const bases = blendState.instanceBase
  refreshEyeKeys(blendState, orderEye(blendState))
  for (let pass = 0; pass < EXPAND_PASSES; pass++) {
    if (!blendState.runCount[pass]) continue
    const written = expandBlendPlan({
      order: orderBlendPlanCpu(blendState, pass),
      runs: blendState.runs[pass],
      runCount: blendState.runCount[pass],
      draws: blendState.drawsPacked,
      keep: blendState.keepPacked,
      itemCounts: blendState.cpuItemCounts,
      instances: blendState.cpuInstances,
      maxVertexWords: blendState.maxVertexWords,
      vertexShift: blendState.vertexShift,
      instanceBase: bases[pass],
      argsBase: blendState.planRegions[pass].args,
      expanded: expandedPacked,
      args: argsPacked,
    })
    const args = blendState.planRegions[pass].args
    if (written)
      device.queue.writeBuffer(
        expandedBuffer,
        bases[pass] * 8,
        expandedPacked.buffer,
        bases[pass] * 8,
        written * 8,
      )
    // Only THIS frame's slots are pushed: a few dozen bytes.
    device.queue.writeBuffer(
      argsBuffer,
      args * 4,
      argsPacked.buffer,
      args * 4,
      blendState.runCount[pass] * 16,
    )
  }
}
