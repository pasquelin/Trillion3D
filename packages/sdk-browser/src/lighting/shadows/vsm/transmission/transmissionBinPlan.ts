/**
 * WHAT A FRAME'S TRANSMISSION BIN TAKES (`transmissionBin.ts`): its views, the chunks of blended
 * rows the GPU budget's room holds (`vsmChunkRowsWithin`), and the lists a chunk takes; the fewest
 * bytes those lists take beside the first transmission.
 */
import { ceilDiv } from '../../../../../../math/src/scalar/integers.ts'
import { createVsmRowBound, vsmChunkRows, type VsmWorst } from '../rows/rowPageBound.ts'
import { answerUnbound } from '../rows/rowBoundFit.ts'
import { vsmChunkRowsWithin, vsmDrawFloorBytes } from '../chunks/chunkLists.ts'
import {
  vsmListSizing,
  vsmSizingFor,
  type VsmListSizes,
  type VsmWithin,
} from '../chunks/chunkSizing.ts'
import { vsmChunkParamSlots, type VsmRenderChunking } from '../chunks/chunkParams.ts'
import { vsmRenderViewBound } from '../mapViews.ts'
import type { VsmRenderScene } from '../render/renderPass.ts'
import { VSM_TRANSMISSION_HEADER_BYTES, VSM_TRANSMISSION_PAGE_BYTES } from './transmissionShared.ts'
import type { VsmTransmission } from './transmissionMade.ts'
import type { VsmTransmissionContext } from './transmissionContext.ts'
import type { VsmTransmissionFrame } from './transmissionPass.ts'

/** Blended candidates a chunk takes: its page list holds this many times the pool's pages. */
const CHUNK_ROWS = 64

/** The frame's rows, worst case, list sizing and bin, rewritten each frame and floor: read at
 *  once. */
const range = { first: 0, end: 0, candidates: 0 }
const worst: VsmWorst = { rows: 0, cmdsPerRow: 0, pages: 0, cap: 0 }
const floorBound = createVsmRowBound()
const floorWorst: VsmWorst = { rows: 0, cmdsPerRow: 0, pages: 0, cap: 0 }
/** The transmission's list sizing: its page list holds a header a command and the pages after
 *  them (`vsmListSizing`); its chunks cut the `used` rows, every blended row a candidate. */
const sizing = vsmListSizing(VSM_TRANSMISSION_PAGE_BYTES, VSM_TRANSMISSION_HEADER_BYTES)

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
  const rows = Math.min(CHUNK_ROWS, used)
  floorWorst.rows = rows
  floorWorst.cmdsPerRow = Math.min(viewMips, pages)
  floorWorst.pages = pages
  floorWorst.cap = rows * pages
  const holds = answerUnbound(floorBound, floorWorst, rows)
  const slots = vsmChunkParamSlots(limits)
  return vsmDrawFloorBytes(
    rows,
    vsmSizingFor(sizing, used, rowCount, viewWords, holds, slots).sizes,
  )
}

/** What a frame's bin takes: its views' bound (the GPU lists those with pages to draw), its chunks
 *  within the GPU budget's room (`vsmChunkRowsWithin`), and the commands and pages a chunk's lists
 *  hold — the chunking of the opaque raster's parameter slots (`../chunks/chunkParams.ts`), `rowCount` the
 *  blended rows. */
export interface BinPlan extends VsmRenderChunking {
  used: number
  within: VsmWithin<VsmListSizes>
}
const plan: BinPlan = {
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
  // Map views, as the opaque raster's: their bound, the GPU listing those with pages to draw.
  const { views, viewMips } = vsmRenderViewBound(frame.lights)
  const rowCount = Math.max(0, frame.rowEnd - frame.rowFirst)
  if (views === 0 || rowCount === 0 || frame.used <= 0) return
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
  const sized = vsmSizingFor(sizing, used, rowCount, 4 * views, chosen, ctx.slots)
  const within = vsmChunkRowsWithin(
    frame.device,
    ctx.buffers,
    chosen.rows,
    sized.sizes,
    sized.within,
  )
  const chunkRows = within.rows
  plan.rowCount = rowCount
  plan.viewCount = views
  plan.used = used
  plan.chunks = within.size ? ceilDiv(used, chunkRows) : 0
  plan.chunkRows = chunkRows
  plan.cmds = chosen.cmds(chunkRows)
  plan.pairs = chosen.pairs(chunkRows)
  return plan
}
