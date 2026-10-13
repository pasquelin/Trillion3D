/**
 * The sizes of the virtual shadow map set, without a device: the layout drawn from the options,
 * and the bytes of every buffer `createVsmResources` makes for it (`resources.ts`). Only constants
 * and arithmetic: the memory budget reads the shadows' share here without the passes
 * (`residency/shadowBudgetBytes.ts`).
 */
import {
  VSM_PAGE_LIST_COUNT,
  VSM_DIRTY_SLICES,
  VSM_LOG2_PAGE,
  VSM_MIPS,
  VSM_POOL_PAGES,
  VSM_SINGLE_PAGE_MAP_SLOTS,
  VSM_PAGE_TEXELS,
  VSM_LEVEL0_PAGES,
  VSM_PAGE_TABLE_BLOCK_HEIGHT,
  VSM_POOL_SLICES,
  VSM_PROJECTION_RECORD_BYTES,
  VSM_TABLE_ROW_WIDTH,
  VSM_COUNTERS,
  VSM_TILE_DEPTHS_PER_PAGE,
  VSM_UNIFORMS_BYTES,
} from './constants.ts'
import {
  alignUp,
  ceilDiv,
  floorLog2,
  isPow2,
  mipSize,
  nextPow2,
} from '../../../math/src/scalar/integers.ts'
import type { VsmFrameBuffers } from './resources.ts'
import type { ShrunkPool } from '../residency/outOfMemory.ts'

type VsmCoverMode = 'directional' | 'none'

export interface VsmResourceOptions {
  /** Physical pages of the pool, default 2048; rounded up to whole pool rows. */
  poolPages?: number
  /** Capacity for full (non single-page) maps: clipmap levels + local light faces. */
  fullMapCapacity: number
  /** Directional maps (clipmap levels), sizes the directional-only receiver cover. */
  sunMapCapacity?: number
  /** Receiver cover kind; default the suns' (the local maps carry none). */
  coverMode?: VsmCoverMode
  /** Separate static cache slice; default true (cache on). */
  cacheEnabled?: boolean
}

/** Everything derived from the options; also what `writeVsmUniforms` needs. */
export interface VsmLayout {
  poolPages: number
  poolPagesXY: [number, number]
  poolTexelsXY: [number, number]
  poolRowShift: number
  poolRowMask: number
  staticSlice: number
  fullMapCapacity: number
  mapSlots: number
  pageTableRowShift: number
  pageTableRowMask: number
  pageTableRows: number
  /** Level-0 texel size of page table / page marks / request flags. */
  pageTableSize: [number, number]
  pageTableWords: number
  /** The page marks: VSM_LOG2_PAGE mips. */
  markMips: number
  markMipOffsets: number[]
  markWordCount: number
  coverMode: VsmCoverMode
  coverSize: [number, number]
  coverMips: number
  coverMipOffsets: number[]
  coverWords: number
  /** The slot count · 8 (one rect per mip), rounded up to a power of two. */
  pageRectCount: number
}

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

function mipChain(width: number, height: number, mips: number) {
  const offsets: number[] = []
  let words = 0
  for (let m = 0; m < mips; m++) {
    offsets.push(words)
    words += mipSize(width, m) * mipSize(height, m)
  }
  return { offsets, words }
}

/** Pure sizing; no device needed: the pool binds in windows every device holds
 *  (`poolWindowSizes`). */
export function vsmLayout(options: VsmResourceOptions): VsmLayout {
  const maxDim = VSM_TABLE_ROW_WIDTH
  const cacheEnabled = options.cacheEnabled ?? true
  // The physical pool: fixed power-of-two row width, height for the requested page count.
  const physicalPagesX = Math.floor(maxDim / VSM_PAGE_TEXELS)
  if (!isPow2(physicalPagesX)) throw new Error('VSM: pool row must be a power of two pages')
  const physicalPagesY = ceilDiv(Math.max(1, options.poolPages ?? VSM_POOL_PAGES), physicalPagesX)
  const poolPages = physicalPagesX * physicalPagesY
  const poolTexelsXY: [number, number] = [
    physicalPagesX * VSM_PAGE_TEXELS,
    physicalPagesY * VSM_PAGE_TEXELS,
  ]

  // The page table: (maxDim/2)/128 tables per row, one extra entry for the single-page block.
  const maxFull = Math.max(0, options.fullMapCapacity)
  const entriesPerRow = Math.floor(maxDim / 2 / VSM_LEVEL0_PAGES)
  if (!isPow2(entriesPerRow)) throw new Error('VSM: page table row must be a power of two tables')
  const pageTableRows = ceilDiv(maxFull + 1, entriesPerRow)
  const pageTableSize: [number, number] = [
    entriesPerRow * VSM_LEVEL0_PAGES,
    pageTableRows * VSM_PAGE_TABLE_BLOCK_HEIGHT,
  ]
  // The page marks carry VSM_LOG2_PAGE mips.
  const markMips = VSM_LOG2_PAGE
  const flags = mipChain(pageTableSize[0], pageTableSize[1], markMips)

  const coverMode: VsmCoverMode = options.coverMode ?? 'directional'
  let coverSize: [number, number], coverMips: number
  if (coverMode === 'directional') {
    // Directional maps (+1 single-page entry), a full row only past one row.
    const required = Math.max(0, options.sunMapCapacity ?? maxFull) + 1
    const rows = ceilDiv(required, entriesPerRow)
    const rowEntries = rows === 1 ? required : entriesPerRow
    coverSize = [2 * rowEntries * VSM_LEVEL0_PAGES, 2 * rows * VSM_PAGE_TABLE_BLOCK_HEIGHT]
    coverMips = VSM_LOG2_PAGE + 1
  } else {
    // A 1x1 stand-in for the absent mask.
    coverSize = [1, 1]
    coverMips = 1
  }
  const masks = mipChain(coverSize[0], coverSize[1], coverMips)

  const mapSlots = VSM_SINGLE_PAGE_MAP_SLOTS + maxFull

  return {
    poolPages,
    poolPagesXY: [physicalPagesX, physicalPagesY],
    poolTexelsXY,
    poolRowShift: floorLog2(physicalPagesX),
    poolRowMask: physicalPagesX - 1,
    staticSlice: cacheEnabled ? 1 : 0,
    fullMapCapacity: maxFull,
    mapSlots,
    pageTableRowShift: floorLog2(entriesPerRow),
    pageTableRowMask: entriesPerRow - 1,
    pageTableRows,
    pageTableSize,
    pageTableWords: pageTableSize[0] * pageTableSize[1],
    markMips,
    markMipOffsets: flags.offsets,
    markWordCount: flags.words,
    coverMode,
    coverSize,
    coverMips,
    coverMipOffsets: masks.offsets,
    coverWords: masks.words,
    pageRectCount: nextPow2(mapSlots * VSM_MIPS),
  }
}

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
    poolLists: VSM_PAGE_LIST_COUNT * (layout.poolPages + 1) * 4,
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

/** A set drawn within a byte budget (`vsmPoolWithin`): its layout, and the bytes it holds. */
type VsmPool = ShrunkPool & { layout: VsmLayout }

/**
 * The set of `options` that `budgetBytes` holds, as a page pool under pressure is
 * held whole and its pages made coarser: the
 * most physical pages among `options.poolPages` (2048 by default) and its halves down to an
 * eighth whose every buffer fits (`vsmResourceBytes`); `undefined` when not even the eighth does.
 * A pool short of the pages asked is `ceiling`, `minimum` at the eighth.
 */
export function vsmPoolWithin(
  budgetBytes: number,
  options: VsmResourceOptions,
): VsmPool | undefined {
  const asked = options.poolPages ?? VSM_POOL_PAGES
  for (let pages = asked; pages >= asked / 8; pages /= 2) {
    const layout = vsmLayout({ ...options, poolPages: pages })
    const allocatedBytes = vsmResourceBytes(layout)
    if (allocatedBytes > budgetBytes) continue
    const clamp = pages === asked ? null : pages <= asked / 8 ? 'minimum' : 'ceiling'
    return { layout, budgetBytes, allocatedBytes, clamp }
  }
  return undefined
}
