import { bitWords, ceilDiv } from '../../../math/src/scalar/integers.ts'
import { NO_INDEX } from '../../../math/src/constants.ts'
import { blendVertexShift, planRegion } from './plan/planLayout.ts'
import { frameCutsAt, orderFrameWords } from './frame/frameHead.ts'
import { instanceBlocks } from './expand/viewRoom.ts'
import { orderStepCount } from './order/orderSteps.ts'
import type { WebgpuBlendState } from './state.ts'

/** Plan entries an item can set at most: the back and the face of a double-sided material that asks two passes. */
export const MAX_SIDES = 2

/** Whether a surface draws its back and its face as two plan entries (`twoSidedPasses`). */
export const asksTwoPasses = (surface: { side: string; twoSidedPasses: boolean }) =>
  surface.side === 'double' && surface.twoSidedPasses

/** Whether the items' passes or responsiveness ask more blocks of the instance list than the buffer holds (`instanceBlocks`): the scene
 *  buffers are mounted again, as when a surface asks more sides. */
export const needsMoreBlocks = (
  blendState: Parameters<typeof instanceBlocks>[0] & { instanceBlocks: number },
) => instanceBlocks(blendState) > blendState.instanceBlocks

/** Whether an item's surface asks two passes where the statics reserved it one entry: its plan would
 *  outgrow the room, so the statics are built again (`mountBlendResources`). The other way round
 *  plans within the room. */
export const needsMoreSides = (
  items: readonly { sides?: number; surface: Parameters<typeof asksTwoPasses>[0] }[],
) =>
  items.some(
    (item) => item.sides !== undefined && item.sides < MAX_SIDES && asksTwoPasses(item.surface),
  )

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
  // The pass expands its instances into the list at the size of the entries RESERVED per item: two
  // for a surface that asks two passes, else one. `sidesOf` (`plan/plan.ts`) reads the item's surface
  // RECORD, written in place by its owner, and never plans past the reservation: a material
  // switched to two passes between two frames is seen by the frame (`needsMoreSides`), which
  // builds these again before the plan. Out-of-bounds kernel writes are dropped silently: transparent geometry would vanish without
  // an error.
  let room = 0,
    entries = 0
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    item.sides = asksTwoPasses(item.surface) ? MAX_SIDES : 1
    entries += item.sides
    const known = table && item.pagedIndex !== undefined
    item.tableBase = known ? table.itemRanges[item.pagedIndex! * 2] : 0
    // An item the table does not hold yet names no entry there, and expands nothing.
    draws[i * 4] = known ? item.pagedIndex! : NO_INDEX
    draws[i * 4 + 2] = item.tableBase
    if (!known) continue
    // Instances a plan entry can expand at most: what the table holds for this item.
    draws[i * 4 + 1] = table.itemRanges[item.pagedIndex! * 2 + 1]
    room += item.sides * draws[i * 4 + 1]
  }
  blendState.instanceCapacity = Math.max(1, room)
  blendState.drawsPacked = draws
  // Same reservation for the plan tables, its slots and the frame data, and for the same reason.
  entries = Math.max(1, entries)
  blendState.maxPlanEntries = entries
  blendState.planRegion = planRegion(entries)
  blendState.runCount = 0
  blendState.orderKeys = new Float64Array(Math.max(1, items.length))
  blendState.orderPriorities = Int32Array.from(items, (item) => item.priority)
  blendState.frameDoubles = new Float64Array(ceilDiv(orderFrameWords(entries, items.length), 2))
  blendState.frameWords = new Uint32Array(blendState.frameDoubles.buffer)
  blendState.frameLayout.cuts = frameCutsAt(entries)
  blendState.cutWords = blendState.frameWords.subarray(
    blendState.frameLayout.cuts,
    blendState.frameLayout.cuts + bitWords(items.length),
  )
  blendState.orderStepWords = new Uint32Array(
    orderStepCount(entries) * (blendState.uniformStride / 4),
  )
  blendState.planMoved = true
}
