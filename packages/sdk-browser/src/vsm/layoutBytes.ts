/**
 * The bytes of every buffer `createVsmResources` makes for a layout (`resources.ts`), without a
 * device: only constants and arithmetic, so the memory budget reads the shadows' share here without
 * the passes (`../residency/shadowBudgetBytes.ts`).
 */
import {
  VSM_COUNTERS,
  VSM_DIRTY_SLICES,
  VSM_POOL_SLICES,
  VSM_PROJECTION_RECORD_BYTES,
  VSM_TILE_DEPTHS_PER_PAGE,
  VSM_UNIFORMS_BYTES,
} from './constants.ts'
import { POOL_SORT_WORDS, poolScratchWords } from '../gpu/pool/sort.ts'
import { alignUp, ceilDiv, floorLog2 } from '../../../math/src/scalar/integers.ts'
import type { VsmFrameBuffers } from './resources.ts'
import type { VsmLayout } from './layout.ts'

/**
 * The frame members no pass binds as the previous frame's: one buffer serves both frames. Each
 * frame clears what it reads of them before reading it (the page table and receiver covers of its
 * maps, the rects of its map count), so last frame's content is never seen. A depth pyramid of the
 * maps (P10) reads last frame's page table: it splits them again.
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
    staleRects: layout.pageRectCount * 16,
    mappedRects: layout.pageRectCount * 16,
    projectionData: layout.mapSlots * VSM_PROJECTION_RECORD_BYTES,
  }
}

/** The buffers made once for both frames and sized by the pool: their names and the bytes asked
 *  for each. */
type VsmSetBuffer =
  | 'poolPageInfo'
  | 'rasterMarks'
  | 'stats'
  | 'feedback'
  | 'pagesToClear'
  | 'pagesToMerge'
  | 'pagesForTiles'
  | 'tileDepths'
  | 'clearArgs'
  | 'mergeArgs'
  | 'tileArgs'
  | 'freePages'

export function setBufferSizes(layout: VsmLayout): Record<VsmSetBuffer, number> {
  const maxPages = layout.poolPages
  return {
    poolPageInfo: maxPages * 24,
    rasterMarks: maxPages * VSM_DIRTY_SLICES * 4,
    stats: VSM_COUNTERS * 4,
    feedback: 16,
    pagesToClear: (2 * maxPages + 1) * 4,
    pagesToMerge: (2 * maxPages + 1) * 4,
    pagesForTiles: (2 * maxPages + 1) * 4,
    tileDepths: maxPages * VSM_TILE_DEPTHS_PER_PAGE * 4,
    clearArgs: 16,
    mergeArgs: 2 * 16,
    tileArgs: 2 * 16,
    // The pool sort's words, the free pages' count and the pages, then the sort's scratch, the
    // whole pool a burst (`freePages`).
    freePages: (POOL_SORT_WORDS + 1 + maxPages + poolScratchWords(maxPages, maxPages)) * 4,
  }
}

/** The buffers made once for both frames and sized by the maps (`growVsmTables`). */
export const tableBufferSizes = (layout: VsmLayout) => ({
  nextMaps: layout.mapSlots * 16,
  perPageIds: layout.mapSlots * 4,
})

/**
 * A window of the pool: WebGPU's guaranteed `maxStorageBufferBindingSize`, the largest binding every
 * device holds. A slice is made of buffers a window each, the last the rest, every one bound whole:
 * the same buffers, bindings and addressing on every device, every pass reading a texel's window
 * from its word (`VSM_POOL_WINDOW_SHIFT`). A window holds whole page rows (8 MiB a row).
 */
const VSM_POOL_WINDOW_BYTES = 2 ** 27
/** log2 of a window's words: a texel's word (`vsmPoolTexelIndexWgsl`) shifted by it is its window. */
export const VSM_POOL_WINDOW_SHIFT = floorLog2(VSM_POOL_WINDOW_BYTES / 4)

/** The bytes of each window of one pool slice: a window each, the last the rest. */
export function poolWindowSizes(layout: VsmLayout) {
  const slice = layout.poolTexelsXY[0] * layout.poolTexelsXY[1] * 4
  return Array.from({ length: ceilDiv(slice, VSM_POOL_WINDOW_BYTES) }, (_, k) =>
    Math.min(VSM_POOL_WINDOW_BYTES, slice - k * VSM_POOL_WINDOW_BYTES),
  )
}

/**
 * The GPU bytes `createVsmResources` makes for `layout`, without a device: every buffer once, the
 * double-buffered frame members twice, the shared ones once (`res.bytes` of the same layout).
 */
export function vsmResourceBytes(layout: VsmLayout) {
  let bytes = vsmTableBytes(layout)
  for (const size of poolWindowSizes(layout)) bytes += VSM_POOL_SLICES * bufferBytes(size)
  for (const size of Object.values(setBufferSizes(layout))) bytes += bufferBytes(size)
  return bytes
}

/** The GPU bytes of the tables of `layout` (`growVsmTables`): both frames' buffers and the
 *  buffers sized by the maps. */
export function vsmTableBytes(layout: VsmLayout) {
  let bytes = 0
  for (const [member, size] of Object.entries(frameBufferSizes(layout)))
    bytes += bufferBytes(size) * (SHARED_FRAME_MEMBERS.has(member) ? 1 : 2)
  for (const size of Object.values(tableBufferSizes(layout))) bytes += bufferBytes(size)
  return bytes
}
