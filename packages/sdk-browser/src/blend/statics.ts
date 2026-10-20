import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { NO_INDEX } from '../../../math/src/constants.ts'
import { blendVertexShift, planRegion } from './plan/planLayout.ts'
import { orderFrameWords } from './frame/frameHead.ts'
import { orderStepCount } from './order/orderSteps.ts'
import type { WebgpuBlendState } from './state.ts'

/** Plan entries an item can set at most: the back and the face of a double-sided material. */
export const MAX_SIDES = 2

/**
 * Static tables of the transparent pass: what an instance draws, and where its item is named.
 *
 * An instance draws a cluster; the addressing stride is the longest one's. The vertex index
 * carries the rank of its run's first instance, not the item rank (`runs.ts`): that is what lets a
 * whole run fit in ONE draw, and all items share ONE bind group. The order's
 * step words and the expansion's uniform slots lie `uniformStride` bytes apart: the device's
 * dynamic-offset alignment, held in the state for the plan and the kernels' buffers.
 */
export function buildBlendStatics(blendState: WebgpuBlendState, uniformStride: number) {
  blendState.uniformStride = uniformStride
  const items = blendState.blendGpu,
    table = blendState.table
  const paged = table?.maxVertexWords ?? 0
  blendState.vertexShift = blendVertexShift(paged)
  blendState.maxVertexWords = Math.max(3, paged)
  const draws = new Uint32Array(Math.max(1, items.length) * 4)
  // The pass expands its instances into the list at the size of the WORST CASE — two plan entries
  // per item — not that of the current plan: `sidesOf` (`plan/plan.ts`) reads the item's surface
  // RECORD, written in place by its owner, and a material switched to double-sided between two
  // frames would overflow the list. Out-of-bounds kernel writes are dropped silently: transparent
  // geometry would vanish without an error.
  let room = 0
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const known = table && item.pagedIndex !== undefined
    item.tableBase = known ? table.itemRanges[item.pagedIndex! * 2] : 0
    // An item the table does not hold yet names no entry there, and expands nothing.
    draws[i * 4] = known ? item.pagedIndex! : NO_INDEX
    draws[i * 4 + 2] = item.tableBase
    if (!known) continue
    // Instances a plan entry can expand at most: what the table holds for this item.
    draws[i * 4 + 1] = table.itemRanges[item.pagedIndex! * 2 + 1]
    room += MAX_SIDES * draws[i * 4 + 1]
  }
  blendState.instanceCapacity = Math.max(1, room)
  blendState.drawsPacked = draws
  // Same worst case for the plan tables, its slots and the frame data, and for the same reason.
  const entries = Math.max(1, items.length) * MAX_SIDES
  blendState.maxPlanEntries = entries
  blendState.planRegion = planRegion(entries)
  blendState.runCount = 0
  blendState.orderKeys = new Float64Array(Math.max(1, items.length))
  blendState.orderPriorities = Int32Array.from(items, (item) => item.priority)
  blendState.frameDoubles = new Float64Array(ceilDiv(orderFrameWords(entries), 2))
  blendState.frameWords = new Uint32Array(blendState.frameDoubles.buffer)
  blendState.orderStepWords = new Uint32Array(
    orderStepCount(entries) * (blendState.uniformStride / 4),
  )
  blendState.planMoved = true
}
