import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { NO_INDEX } from '../../../../math/src/constants.ts'
import { EXPAND_PASSES, blendChunkWords, blendVertexShift, planRegions } from './planLayout.ts'
import { orderFrameWords } from './frameHead.ts'
import { orderStepCount } from './orderSteps.ts'
import type { BlendGpuItem, WebgpuBlendState } from './state.ts'

/** Plan entries an item can set at most: the back and the face of a double-sided material. */
export const MAX_SIDES = 2

/**
 * Addressing stride of the scene: large enough for the longest instance, small enough for the
 * rank of a run's first instance to fit in the high bits of a vertex index. A paged cluster sets
 * the floor; an unpaged primitive, split into chunks, can yield if the expanded list gets too long.
 */
function sceneVertexShift(items: readonly BlendGpuItem[], paged: number, capacity: number) {
  // Only UNPAGED primitives depend on the stride: their lengths are gathered once, and capacity
  // is recomputed on that list alone when the stride yields.
  const libres: number[] = []
  let longest = paged
  for (const item of items)
    if (!item.paged) {
      libres.push(item.count)
      longest = Math.max(longest, item.count)
    }
  const floor = blendVertexShift(paged)
  let shift = blendVertexShift(longest)
  while (shift > floor && instanceCapacity(libres, shift, capacity) * 2 ** shift > 0xffffffff)
    shift--
  return shift
}

/** Instances the scene can expand at most: the paged table, plus the others' chunks, and all of
 *  that twice — a double-sided material drawn in two passes carries two plan entries. */
function instanceCapacity(libres: readonly number[], shift: number, capacity: number) {
  let total = capacity
  for (const count of libres) total += ceilDiv(count, blendChunkWords(shift, count))
  return total * MAX_SIDES
}

/**
 * Static tables of the transparent pass: what an instance draws, and where its item is named.
 *
 * A paged instance draws a cluster, an unpaged instance a chunk of at most one index stride. The
 * vertex index carries the rank of its run's first instance, not the item rank (`runs.ts`): that
 * is what lets a whole run fit in ONE draw, and all paged items share ONE bind group. The order's
 * step words and the expansion's uniform slots lie `uniformStride` bytes apart: the device's
 * dynamic-offset alignment, held in the state for the plan and the kernels' buffers.
 */
export function buildBlendStatics(blendState: WebgpuBlendState, uniformStride: number) {
  blendState.uniformStride = uniformStride
  const items = blendState.blendGpu,
    table = blendState.table
  const paged = table?.maxVertexWords ?? 0
  const shift = sceneVertexShift(items, paged, table?.length ?? 0)
  blendState.vertexShift = shift
  blendState.maxVertexWords = Math.max(3, paged)
  const draws = new Uint32Array(Math.max(1, items.length) * 4)
  // The two passes expand their instances into TWO disjoint regions of the same list. Their size
  // is that of the WORST CASE — two plan entries per item — not that of the current plan:
  // `sidesOf` (`plan.ts`) reads the item's surface RECORD, written in place by its owner, and a material switched
  // to double-sided between two frames would overflow the list and push the transmission region
  // past its end. Out-of-bounds kernel writes are dropped silently: transparent geometry would
  // vanish without an error.
  const room = [0, 0]
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    item.tableBase =
      item.paged && table && item.pagedIndex !== undefined
        ? table.itemRanges[item.pagedIndex * 2]
        : 0
    const known = item.paged && table && item.pagedIndex !== undefined
    // An unpaged item names no paged primitive: it draws its own indices, in chunks.
    draws[i * 4] = known ? item.pagedIndex! : NO_INDEX
    draws[i * 4 + 2] = item.tableBase
    if (known) {
      // Instances a plan entry can expand at most: what the table holds for this item. The kernel
      // reads this word only for an unpaged primitive.
      draws[i * 4 + 1] = table!.itemRanges[item.pagedIndex! * 2 + 1]
      room[item.transmissive ? 1 : 0] += MAX_SIDES * draws[i * 4 + 1]
      continue
    }
    const words = blendChunkWords(shift, item.count)
    draws[i * 4 + 1] = ceilDiv(item.count, words)
    draws[i * 4 + 3] = words
    room[item.transmissive ? 1 : 0] += MAX_SIDES * draws[i * 4 + 1]
  }
  blendState.instanceBase[1] = room[0]
  blendState.instanceCapacity = Math.max(1, room[0] + room[1])
  blendState.drawsPacked = draws
  // Same worst case for the plan tables, its slots and the frame data, and for the same reason.
  const entries = Math.max(1, items.length) * MAX_SIDES
  blendState.maxPlanEntries = entries
  blendState.planRegions = planRegions(entries)
  blendState.runCount.fill(0)
  blendState.orderKeys = new Float64Array(Math.max(1, items.length))
  blendState.ownRanks = new Uint32Array(items.length)
  blendState.frameDoubles = new Float64Array(ceilDiv(orderFrameWords(items.length, entries), 2))
  blendState.frameWords = new Uint32Array(blendState.frameDoubles.buffer)
  blendState.orderStepWords = new Uint32Array(
    EXPAND_PASSES * orderStepCount(entries) * (blendState.uniformStride / 4),
  )
  blendState.planMoved = true
}
