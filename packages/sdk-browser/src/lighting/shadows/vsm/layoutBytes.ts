/**
 * The bytes of every buffer `createVsmResources` makes for a layout (`resources.ts`), without a
 * device: only constants and arithmetic, so the memory budget reads the shadows' share here without
 * the passes (`../../../session/memory/shadowBudgetBytes.ts`).
 */
import { storageBufferCap } from '../../../session/memory/pools.ts'
import {
  FEEDBACK_MESSAGE_BYTES,
  VSM_STATS_WORDS,
  VSM_DIRTY_SLICES,
  VSM_KEPT_RECTS_WIDTH,
  VSM_MIPS,
  VSM_PAGE_TEXELS,
  VSM_PYRAMID_MIPS,
  VSM_POOL_SLICES,
  VSM_PROJECTION_RECORD_BYTES,
  VSM_UNIFORMS_BYTES,
} from './constants.ts'
import { POOL_SORT_WORDS, poolScratchWords } from '../../../gpu/sort/sortWords.ts'
import { alignUp, ceilDiv, floorPow2, mipSize } from '../../../../../math/src/scalar/integers.ts'
import type { VsmFrameBuffers } from './resources.ts'
import type { VsmLayout } from './layout.ts'
import {
  VSM_FILTER_ARGS_WORDS,
  VSM_FILTER_LISTS,
  vsmFilterablePoolBytes,
  vsmHistoryLayout,
} from './prefilteredConstants.ts'

/**
 * The frame members no pass binds as the previous frame's: one buffer serves both frames. Each
 * frame clears what it reads of them before reading it (the page table and receiver covers of its
 * maps, the rects of its map count), so last frame's content is never seen. The occlusion culling
 * reads last frame's page table and rects through its kept tables, copied each frame
 * (`occlusion/occlusionResources.ts`).
 */
export const SHARED_FRAME_MEMBERS: ReadonlySet<string> = new Set<keyof VsmFrameBuffers>([
  'pageTable',
  'receiverCover',
  'staleRects',
])

/** What a buffer asked for `size` bytes is made at: whole words, never under 16 bytes. */
export const bufferBytes = (size: number) => Math.max(16, alignUp(size, 4))

/** The bytes asked for each buffer of one frame (`VsmFrameBuffers`), in creation order. */
export function frameBufferSizes(layout: VsmLayout): Record<keyof VsmFrameBuffers, number> {
  return {
    uniforms: VSM_UNIFORMS_BYTES,
    pageTable: layout.pageTableWords * 4,
    pageMarks: layout.markWordCount * 4,
    receiverCover: layout.coverWords * 4,
    pageRequests: layout.pageTableWords * 4,
    // Two a (map, mip): its dynamic layer's, then its static layer's (`vsmStaleRectIndex`).
    staleRects: layout.pageRectCount * 32,
    mappedRects: layout.pageRectCount * 16,
    projectionData: layout.mapSlots * VSM_PROJECTION_RECORD_BYTES,
  }
}

/** The buffers made once for both frames and sized by the pool: their names and the bytes asked
 *  for each. */
type VsmSetBuffer =
  'poolPageInfo' | 'rasterMarks' | 'stats' | 'feedback' | 'pagesToClear' | 'clearArgs' | 'freePages'

export function setBufferSizes(layout: VsmLayout): Record<VsmSetBuffer, number> {
  const maxPages = layout.poolPages
  return {
    poolPageInfo: maxPages * 24,
    rasterMarks: (maxPages * VSM_DIRTY_SLICES + 1) * 4,
    stats: VSM_STATS_WORDS * 4,
    feedback: FEEDBACK_MESSAGE_BYTES,
    pagesToClear: (2 * maxPages + 1) * 4,
    clearArgs: 16,
    // The pool sort's words, the free pages' count, their shortfall and the pages, then the sort's
    // scratch, the whole pool a burst (`freePages`).
    freePages: (POOL_SORT_WORDS + 2 + maxPages + poolScratchWords(maxPages, maxPages)) * 4,
  }
}

/** The buffers made once for both frames and sized by the maps (`growVsmTables`). */
export const tableBufferSizes = (layout: VsmLayout) => ({
  nextMaps: layout.mapSlots * 16,
  perPageIds: layout.mapSlots * 4,
})

/** The prefiltered distant shadow's buffers and the bytes asked for each (`VsmFilterable`): the byte
 *  pool `separate` (made twice, the passes' history and the frame's), the merged one, which the
 *  separable passes also use as their temporary pool, the indirect arguments and their empty form,
 *  the lists of the pages selected. The previous frame's history is sized by the tables
 *  (`filterableHistoryBytes`). */
export function filterableBufferSizes(layout: VsmLayout) {
  const pool = vsmFilterablePoolBytes(layout)
  return {
    separate: pool,
    merged: pool,
    args: VSM_FILTER_ARGS_WORDS * 4,
    argsInit: VSM_FILTER_ARGS_WORDS * 4,
    pages: VSM_FILTER_LISTS * layout.poolPages * 4,
  }
}

/** The bytes asked for the history of the prefiltered distant shadow of `layout`. */
export const filterableHistoryBytes = (layout: VsmLayout) => vsmHistoryLayout(layout).words * 4

/** The bytes of a pool page: 128 × 128 words. */
const VSM_PAGE_BYTES = VSM_PAGE_TEXELS * VSM_PAGE_TEXELS * 4

/** The bytes of one pool slice: a buffer bound whole, one binding for every reader. */
export const poolSliceBytes = (layout: VsmLayout) =>
  layout.poolTexelsXY[0] * layout.poolTexelsXY[1] * 4

/**
 * The most physical pages a pool slice holds in one binding of a device of `limits`: the largest
 * power of two of pages whose bytes fit both its largest binding and its largest buffer (WebGPU
 * § 3.6.2, `maxStorageBufferBindingSize`, `maxBufferSize`). Every reader binds one buffer a
 * slice — the passes outside the shadows have no storage binding to spare for a second window —,
 * so a device that grants less than the level asks holds the largest pool that fits.
 */
export const vsmPoolPagesBound = (
  limits: Pick<GPUSupportedLimits, 'maxStorageBufferBindingSize' | 'maxBufferSize'>,
) => floorPow2(storageBufferCap(limits) / VSM_PAGE_BYTES)

/** The rows of the kept stale rects' texture (`VSM_KEPT_RECTS_WIDTH` texels a row): every rect of
 *  the layout, two a (map, mip). */
export const keptRectRows = (layout: VsmLayout) =>
  ceilDiv(2 * layout.pageRectCount, VSM_KEPT_RECTS_WIDTH)

/** The rows of the kept stale rects a frame of `mapCount` maps copies: those its maps' rects fill. */
export const keptRectRowsOf = (mapCount: number) =>
  ceilDiv(2 * VSM_MIPS * mapCount, VSM_KEPT_RECTS_WIDTH)

/** The bytes of one frame set's kept tables (`occlusion/occlusionResources.ts`): its page table
 *  and its pages' marks, a word a page, and its stale rects, 16 bytes each. */
const keptTableBytes = (layout: VsmLayout) =>
  2 * layout.pageTableWords * 4 + keptRectRows(layout) * VSM_KEPT_RECTS_WIDTH * 16

/** The bytes of the occlusion pyramid of `layout`, every level (`occlusion/occlusionResources.ts`):
 *  one 32-bit float a texel. */
function occlusionPyramidBytes(layout: VsmLayout) {
  const [width, height] = layout.pyramidSize
  let bytes = 0
  for (let level = 0; level < VSM_PYRAMID_MIPS; level++)
    bytes += mipSize(width, level) * mipSize(height, level) * 4
  return bytes * layout.hzbLayers
}

/** The buffers the occlusion's pyramid build makes with the set: the pages it rebuilds (one word a
 *  pool page and one more), its two dispatches' arguments and their cleared copy, its parameters. */
export const occlusionBufferSizes = (layout: VsmLayout) => ({
  pyramidPages: (layout.poolPages + 1) * 4,
  pyramidArgs: 32,
  pyramidArgsInit: 32,
  pyramidParams: 16,
})

/**
 * The GPU bytes `createVsmResources` makes for `layout`, without a device: every buffer once, the
 * double-buffered frame members twice, the shared ones once, and with the occlusion its pyramid and
 * its buffers, with the prefiltered distant shadow its pools (`res.bytes` of the same layout).
 */
export function vsmResourceBytes(layout: VsmLayout) {
  let bytes = vsmTableBytes(layout)
  bytes += VSM_POOL_SLICES * bufferBytes(poolSliceBytes(layout))
  for (const size of Object.values(setBufferSizes(layout))) bytes += bufferBytes(size)
  if (layout.occlusion) {
    bytes += occlusionPyramidBytes(layout)
    for (const size of Object.values(occlusionBufferSizes(layout))) bytes += bufferBytes(size)
  }
  if (layout.prefilteredDistant) {
    const { separate, ...once } = filterableBufferSizes(layout)
    bytes += 2 * bufferBytes(separate)
    for (const size of Object.values(once)) bytes += bufferBytes(size)
  }
  return bytes
}

/** The GPU bytes of the tables of `layout` (`growVsmTables`): both frames' buffers, the buffers
 *  sized by the maps and, with the occlusion, both frame sets' kept tables. */
export function vsmTableBytes(layout: VsmLayout) {
  let bytes = 0
  for (const [member, size] of Object.entries(frameBufferSizes(layout)))
    bytes += bufferBytes(size) * (SHARED_FRAME_MEMBERS.has(member) ? 1 : 2)
  for (const size of Object.values(tableBufferSizes(layout))) bytes += bufferBytes(size)
  if (layout.occlusion) bytes += 2 * keptTableBytes(layout)
  if (layout.prefilteredDistant) bytes += bufferBytes(filterableHistoryBytes(layout))
  return bytes
}
