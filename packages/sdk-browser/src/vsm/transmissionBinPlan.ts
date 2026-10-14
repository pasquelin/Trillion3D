/**
 * WHAT A FRAME'S TRANSMISSION BIN TAKES (`transmissionBin.ts`): its views, the chunks of blended
 * rows the GPU budget's room holds (`vsmChunkRowsWithin`), and the lists a chunk takes; the fewest
 * bytes those lists take beside the first transmission.
 */
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import type { UniformSlots } from '../residency/pools.ts'
import { vsmWorstChunk, type VsmChunk } from './rowPageBound.ts'
import { vsmChunkRows } from './chunkKernels.ts'
import { vsmChunkListSizes, vsmChunkRowsWithin, vsmDrawFloorBytes } from './chunkLists.ts'
import { vsmChunkParamSlots, vsmRenderViews, vsmSetChunking } from './chunkParams.ts'
import type { VsmRenderScene } from './renderPass.ts'
import { VSM_TRANSMISSION_HEADER_BYTES, VSM_TRANSMISSION_PAGE_BYTES } from './transmissionWgsl.ts'
import type { VsmTransmission } from './transmissionMade.ts'
import type { VsmTransmissionContext } from './transmissionContext.ts'
import type { VsmTransmissionFrame } from './transmissionPass.ts'

/** Blended candidates a chunk takes: its page list holds this many times the pool's pages. */
const CHUNK_ROWS = 64

/** The frame's map views, rewritten each frame. */
const viewList: number[] = []

/** The transmission's lists for a chunk of `rows` of its `used` blended rows, by buffer: the
 *  render lists, their parameter slots `slots`, its page list holding a header a
 *  command and the pages after them. */
const transmissionSizes =
  (used: number, rowCount: number, viewWords: number, holds: VsmChunk, slots: UniformSlots) =>
  (rows: number) => ({
    ...vsmChunkListSizes(rows, used, rowCount, viewWords, holds, slots),
    pairs:
      holds.cmds(rows) * VSM_TRANSMISSION_HEADER_BYTES +
      holds.pairs(rows) * VSM_TRANSMISSION_PAGE_BYTES,
  })

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
  const holds = vsmWorstChunk(Math.min(CHUNK_ROWS, used), Math.min(viewMips, pages), pages)
  return vsmDrawFloorBytes(
    Math.min(CHUNK_ROWS, used),
    transmissionSizes(used, rowCount, viewWords, holds, vsmChunkParamSlots(limits)),
  )
}

/** What a frame's bin takes: its views, its chunks within the GPU budget's room
 *  (`vsmChunkRowsWithin`), and the commands and pages a chunk's lists hold. */
export interface BinPlan {
  views: number[]
  rowCount: number
  used: number
  within: ReturnType<typeof vsmChunkRowsWithin<ReturnType<ReturnType<typeof transmissionSizes>>>>
  chunks: number
  cmds: number
  pairs: number
}

/** The frame's bin: the blended rows' chunks the GPU budget's room holds (`vsmChunkRowsWithin`),
 *  none when not even one row's lists fit; undefined without a view or a row. */
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
  const chosen = vsmChunkRows(
    ctx.rowBound,
    scene.rowSpheres,
    { first: frame.rowFirst, end: frame.rowEnd, candidates: used },
    frame.lights,
    {
      rows: Math.min(CHUNK_ROWS, used),
      cmdsPerRow: Math.min(viewMips, pages),
      pages,
      cap: CHUNK_ROWS * pages,
    },
  )
  const within = vsmChunkRowsWithin(
    frame.device,
    ctx.buffers,
    chosen.rows,
    transmissionSizes(used, rowCount, views.length, chosen, ctx.slots),
  )
  const chunkRows = within.rows
  // The opaque raster's parameter slots (`chunkParams.ts`), `rowCount` = the blended rows.
  if (within.size)
    vsmSetChunking(
      {
        rowCount,
        viewCount: views.length / 4,
        chunks: ceilDiv(used, chunkRows),
        chunkRows,
      },
      chosen,
    )
  return {
    views,
    rowCount,
    used,
    within,
    chunks: within.size ? ceilDiv(used, chunkRows) : 0,
    cmds: chosen.cmds(chunkRows),
    pairs: chosen.pairs(chunkRows),
  }
}
