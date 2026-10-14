/**
 * The sizes of the virtual shadow map set, without a device: the layout drawn from the options;
 * the bytes of every buffer `createVsmResources` makes for it are `layoutBytes.ts`'s, the pool a
 * budget holds `poolDraw.ts`'s. Only constants and arithmetic.
 */
import {
  VSM_LOG2_PAGE,
  VSM_MIPS,
  VSM_POOL_PAGES,
  VSM_SINGLE_PAGE_MAP_SLOTS,
  VSM_PAGE_TEXELS,
  VSM_LEVEL0_PAGES,
  VSM_PAGE_TABLE_BLOCK_HEIGHT,
  VSM_TABLE_ROW_WIDTH,
} from './constants.ts'
import { ceilDiv, floorLog2, isPow2, mipSize, nextPow2 } from '../../../math/src/scalar/integers.ts'

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

function mipChain(width: number, height: number, mips: number) {
  const offsets: number[] = []
  let words = 0
  for (let m = 0; m < mips; m++) {
    offsets.push(words)
    words += mipSize(width, m) * mipSize(height, m)
  }
  return { offsets, words }
}

/** Full maps a page-table row holds: half a row's width over a map's level-0 pages, a power of two;
 *  one extra entry of the last row holds the single-page maps. */
export const VSM_TABLES_PER_ROW = VSM_TABLE_ROW_WIDTH / 2 / VSM_LEVEL0_PAGES
if (!isPow2(VSM_TABLES_PER_ROW))
  throw new Error('VSM: page table row must be a power of two tables')

/** The physical pool's row, in pages: one page-table row's width, a power of two. */
const POOL_PAGES_X = Math.floor(VSM_TABLE_ROW_WIDTH / VSM_PAGE_TEXELS)
if (!isPow2(POOL_PAGES_X)) throw new Error('VSM: pool row must be a power of two pages')

/** Pure sizing; no device needed: the pool binds in windows every device holds
 *  (`poolWindowSizes`). */
export function vsmLayout(options: VsmResourceOptions): VsmLayout {
  const cacheEnabled = options.cacheEnabled ?? true
  // The physical pool: fixed power-of-two row width, height for the requested page count.
  const physicalPagesY = ceilDiv(Math.max(1, options.poolPages ?? VSM_POOL_PAGES), POOL_PAGES_X)
  const poolPages = POOL_PAGES_X * physicalPagesY
  const poolTexelsXY: [number, number] = [
    POOL_PAGES_X * VSM_PAGE_TEXELS,
    physicalPagesY * VSM_PAGE_TEXELS,
  ]

  // The page table: `VSM_TABLES_PER_ROW` tables a row, one extra entry for the single-page block.
  const maxFull = Math.max(0, options.fullMapCapacity)
  const pageTableRows = ceilDiv(maxFull + 1, VSM_TABLES_PER_ROW)
  const pageTableSize: [number, number] = [
    VSM_TABLES_PER_ROW * VSM_LEVEL0_PAGES,
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
    const rows = ceilDiv(required, VSM_TABLES_PER_ROW)
    const rowEntries = rows === 1 ? required : VSM_TABLES_PER_ROW
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
    poolPagesXY: [POOL_PAGES_X, physicalPagesY],
    poolTexelsXY,
    poolRowShift: floorLog2(POOL_PAGES_X),
    poolRowMask: POOL_PAGES_X - 1,
    staticSlice: cacheEnabled ? 1 : 0,
    fullMapCapacity: maxFull,
    mapSlots,
    pageTableRowShift: floorLog2(VSM_TABLES_PER_ROW),
    pageTableRowMask: VSM_TABLES_PER_ROW - 1,
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
