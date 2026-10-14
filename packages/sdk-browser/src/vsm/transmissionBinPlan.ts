/**
 * WHAT A FRAME'S TRANSMISSION BIN TAKES (`transmissionBin.ts`): its views, the chunks of blended
 * rows the GPU budget's room holds (`vsmChunkRowsWithin`), and the lists a chunk takes; the fewest
 * bytes those lists take beside the first transmission.
 */
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import type { UniformSlots } from '../residency/pools.ts'
import { createWorstChunk, vsmWorstChunk, type VsmChunk, type VsmWorst } from './rowPageBound.ts'
import { vsmChunkRows } from './chunkKernels.ts'
import {
  vsmChunkRowsWithin,
  vsmDrawFloorBytes,
  vsmListSizing,
  type VsmListSizes,
  type VsmWithin,
} from './chunkLists.ts'
import { vsmChunkParamSlots, vsmRenderViews, type VsmRenderChunking } from './chunkParams.ts'
import type { VsmRenderScene } from './renderPass.ts'
import { VSM_TRANSMISSION_HEADER_BYTES, VSM_TRANSMISSION_PAGE_BYTES } from './transmissionShared.ts'
import type { VsmTransmission } from './transmissionMade.ts'
import type { VsmTransmissionContext } from './transmissionContext.ts'
import type { VsmTransmissionFrame } from './transmissionPass.ts'

/** Blended candidates a chunk takes: its page list holds this many times the pool's pages. */
const CHUNK_ROWS = 64

/** The frame's map views, rows, worst case, list sizing and bin, rewritten each frame and floor:
 *  read at once. */
const viewList: number[] = []
const range = { first: 0, end: 0, candidates: 0 }
const worst: VsmWorst = { rows: 0, cmdsPerRow: 0, pages: 0, cap: 0 }
const floorChunk = createWorstChunk()
const sizing = vsmListSizing(VSM_TRANSMISSION_PAGE_BYTES, VSM_TRANSMISSION_HEADER_BYTES)

/** The transmission's list sizing for a chunk of its `used` of `rowCount` blended rows: the
 *  render lists, their parameter slots `slots`, its page list holding a header a command and the
 *  pages after them (`vsmListSizing`); rewritten in place. */
function transmissionSizes(
  used: number,
  rowCount: number,
  viewWords: number,
  holds: Omit<VsmChunk, 'rows'>,
  slots: UniformSlots,
) {
  sizing.chunked = used
  sizing.candidates = rowCount
  sizing.viewWords = viewWords
  sizing.holds = holds
  sizing.slots = slots
  return sizing
}

/**
 * The fewest bytes a transmission's chunk lists take to bin `used` of `rowCount` blended rows
 * under views of `viewWords` words and `viewMips` mips at `pages` pages (`vsmDrawFloorBytes`), on
 * a device of `limits`. Asked with the first transmission.
 */
export function vsmTransmissionFloorBytes(
  limits: GPUSupportedLimits,
  used: number,
  rowCount: number,
  viewWords: number,
  viewMips: number,
  pages: number,
) {
  if (used <= 0 || rowCount <= 0 || viewWords <= 0) return 0
  const rows = Math.min(CHUNK_ROWS, used),
    holds = vsmWorstChunk(floorChunk, rows, Math.min(viewMips, pages), pages)
  const slots = vsmChunkParamSlots(limits)
  return vsmDrawFloorBytes(rows, transmissionSizes(used, rowCount, viewWords, holds, slots).sizes)
}

/** What a frame's bin takes: its views, its chunks within the GPU budget's room
 *  (`vsmChunkRowsWithin`), and the commands and pages a chunk's lists hold — the chunking of the
 *  opaque raster's parameter slots (`chunkParams.ts`), `rowCount` the blended rows. */
export interface BinPlan extends VsmRenderChunking {
  views: number[]
  used: number
  within: VsmWithin<VsmListSizes>
}
const plan: BinPlan = {
  views: viewList,
  used: 0,
  within: sizing.within,
  rowCount: 0,
  viewCount: 0,
  chunks: 0,
  chunkRows: 0,
  cmds: 0,
  pairs: 0,
}

/** The frame's bin: the blended rows' chunks the GPU budget's room holds (`vsmChunkRowsWithin`),
 *  none when not even one row's lists fit; undefined without a view or a row. Rewritten in place. */
export function binPlan(
  ctx: VsmTransmissionContext,
  trans: VsmTransmission,
  frame: VsmTransmissionFrame,
  scene: VsmRenderScene,
): BinPlan | undefined {
  // Map views, as the opaque raster's.
  const { views, viewMips } = vsmRenderViews(frame.lights, viewList)
  const rowCount = Math.max(0, frame.rowEnd - frame.rowFirst)
  if (views.length === 0 || rowCount === 0 || frame.used <= 0) return
  const pages = trans.layout.poolPages
  const used = Math.min(frame.used, rowCount)
  range.first = frame.rowFirst
  range.end = frame.rowEnd
  range.candidates = used
  worst.rows = Math.min(CHUNK_ROWS, used)
  worst.cmdsPerRow = Math.min(viewMips, pages)
  worst.pages = pages
  worst.cap = CHUNK_ROWS * pages
  const chosen = vsmChunkRows(ctx.rowBound, scene.rowSpheres, range, frame.lights, worst)
  const sized = transmissionSizes(used, rowCount, views.length, chosen, ctx.slots)
  const within = vsmChunkRowsWithin(
    frame.device,
    ctx.buffers,
    chosen.rows,
    sized.sizes,
    sized.within,
  )
  const chunkRows = within.rows
  plan.rowCount = rowCount
  plan.viewCount = views.length / 4
  plan.used = used
  plan.chunks = within.size ? ceilDiv(used, chunkRows) : 0
  plan.chunkRows = chunkRows
  plan.cmds = chosen.cmds(chunkRows)
  plan.pairs = chosen.pairs(chunkRows)
  return plan
}
