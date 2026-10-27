/**
 * The sizes of the virtual shadow map set, without a device: the layout drawn from the options;
 * the bytes of every buffer `createVsmResources` makes for it are `layoutBytes.ts`'s, the pool a
 * budget holds `poolDraw.ts`'s. Only constants and arithmetic.
 */
import {
  VSM_LOG2_PAGE,
  VSM_MIPS,
  VSM_POOL_PAGES,
  VSM_PAGE_TEXELS,
  VSM_LEVEL0_PAGES,
  VSM_RECORD_MAP_ID_BITS,
  VSM_PAGE_TABLE_BLOCK_HEIGHT,
  VSM_TABLE_ROW_WIDTH,
} from './constants.ts'
import {
  ceilDiv,
  floorLog2,
  isPow2,
  mipSize,
  nextPow2,
} from '../../../../../math/src/scalar/integers.ts'

type VsmCoverMode = 'directional' | 'none'

export interface VsmResourceOptions {
  /** Physical pages of the pool, default 2048; rounded up to whole pool rows. */
  poolPages?: number
  /** Page-table blocks of 128 × 192: a map whose finest mip is 0 takes one, a coarser one a
   *  quarter or less (`tableBlocks.ts`). */
  fullMapCapacity: number
  /** Directional maps (clipmap levels), sizes the directional-only receiver cover. */
  sunMapCapacity?: number
  /** Receiver cover kind; default the suns' (the local maps carry none). */
  coverMode?: VsmCoverMode
  /** Map slots past one a block: at least the default; more as the lights ask them, up to the ids
   *  a map takes (`VSM_RECORD_MAP_ID_BITS`). */
  mapSlotsPast?: number
  /** Separate static cache slice; default true (cache on). */
  cacheEnabled?: boolean
  /** The receiver cover holds every map's, the local lights' too (`shadowUseReceiverMaskLocal`), not
   *  the suns' alone; default false. */
  localCover?: boolean
  /** The occlusion culling of the casters against the maps' depth pyramid (`shadowOcclusionCulling`):
   *  the pyramid and the tables it is read through are made with the set; default true. */
  occlusion?: boolean
  /** A second layer of that pyramid for the dynamic casters (`shadowDynamicHzb`), where the cache and
   *  the occlusion are on; default false. */
  dynamicHzb?: boolean
}

/** Everything derived from the options; also what `writeVsmUniforms` needs. */
export interface VsmLayout {
  poolPages: number
  poolPagesXY: [number, number]
  poolTexelsXY: [number, number]
  poolRowShift: number
  poolRowMask: number
  /** Whether the pages are kept from one frame to the next (`cacheEnabled`); the static casters
   *  are then drawn to the pool slice 1, else all to slice 0. */
  cacheEnabled: boolean
  fullMapCapacity: number
  mapSlots: number
  pageTableRows: number
  /** Level-0 texel size of page table / page marks / request flags. */
  pageTableSize: [number, number]
  pageTableWords: number
  /** The page marks: VSM_LOG2_PAGE mips. */
  markMips: number
  markMipOffsets: number[]
  markWordCount: number
  coverMode: VsmCoverMode
  /** Whether the cover holds every map (`localCover`). */
  coverLocal: boolean
  coverSize: [number, number]
  coverMips: number
  coverMipOffsets: number[]
  coverWords: number
  /** The slot count · 8 (one rect per mip), rounded up to a power of two. */
  pageRectCount: number
  /** Whether the set holds the occlusion culling's depth pyramid and kept tables (`occlusion`). */
  occlusion: boolean
  /** The layers of the pyramid: 2 with a pyramid of the dynamic casters' own (`dynamicHzb`), else 1;
   *  the static casters' layer is the one at `hzbStaticLayer`. */
  hzbLayers: number
  /** The pyramid's layer the static casters are tested against: 1 with two layers, else 0. */
  hzbStaticLayer: number
  /** The depth pyramid's level 0, in texels: half the pool's power-of-two extent, one texel a 2x2
   *  of pool texels (`vsmPyramidSize`). */
  pyramidSize: [number, number]
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

/** Blocks a page-table row holds: half a row's width over a map's level-0 pages, a power of two. */
export const VSM_TABLES_PER_ROW = VSM_TABLE_ROW_WIDTH / 2 / VSM_LEVEL0_PAGES
if (!isPow2(VSM_TABLES_PER_ROW))
  throw new Error('VSM: page table row must be a power of two tables')

/** Declared: the maps a set holds past one a block unless the lights ask more (`mapSlotsPast`), the records a frame may write beyond its blocks:
 *  a map whose finest mip is coarser than 0 takes a quarter of a block or less (`tableBlocks.ts`),
 *  so far lights take records, not table rows. Each is a projection record (304 B) of both frames. */
const VSM_MAPS_PAST_BLOCKS = 1024 * 8

/** The physical pool's row, in pages: one page-table row's width, a power of two. */
export const POOL_PAGES_X = Math.floor(VSM_TABLE_ROW_WIDTH / VSM_PAGE_TEXELS)
if (!isPow2(POOL_PAGES_X)) throw new Error('VSM: pool row must be a power of two pages')

/** The cover masks' mode and size: directional maps take the first blocks (`tableBlocks.ts`), a full
 *  row only past one row, all the blocks with `localCover`; any other mode a 1x1 stand-in for the
 *  absent mask. */
function coverLayout(options: VsmResourceOptions, maxFull: number) {
  const coverMode: VsmCoverMode = options.coverMode ?? 'directional'
  const coverLocal = options.localCover ?? false
  let coverSize: [number, number], coverMips: number
  if (coverMode === 'directional') {
    const required = coverLocal ? maxFull : Math.max(1, options.sunMapCapacity ?? maxFull)
    const rows = ceilDiv(required, VSM_TABLES_PER_ROW)
    const rowEntries = rows === 1 ? required : VSM_TABLES_PER_ROW
    coverSize = [2 * rowEntries * VSM_LEVEL0_PAGES, 2 * rows * VSM_PAGE_TABLE_BLOCK_HEIGHT]
    coverMips = VSM_LOG2_PAGE + 1
  } else {
    coverSize = [1, 1]
    coverMips = 1
  }
  return { coverMode, coverLocal, coverSize, coverMips }
}

/** Whether the set holds the dynamic casters' own pyramid layer: the pyramid and a static slice to
 *  keep apart must be on (`occlusion`, `cacheEnabled`), and the layer asked (`dynamicHzb`). */
export const dynamicHzbOf = (occlusion: boolean, cacheEnabled: boolean, dynamicHzb?: boolean) =>
  occlusion && cacheEnabled && !!dynamicHzb

/** Pure sizing; no device needed: each pool slice is one buffer, bound whole
 *  (`poolSliceBytes`; the pages a device's binding holds, `vsmPoolPagesBound`). */
export function vsmLayout(options: VsmResourceOptions): VsmLayout {
  const cacheEnabled = options.cacheEnabled ?? true,
    occlusion = options.occlusion ?? true
  // The physical pool: fixed power-of-two row width, height for the requested page count.
  const physicalPagesY = ceilDiv(Math.max(1, options.poolPages ?? VSM_POOL_PAGES), POOL_PAGES_X)
  const poolPages = POOL_PAGES_X * physicalPagesY
  const poolTexelsXY: [number, number] = [
    POOL_PAGES_X * VSM_PAGE_TEXELS,
    physicalPagesY * VSM_PAGE_TEXELS,
  ]

  // The page table: `VSM_TABLES_PER_ROW` blocks a row, one block at least.
  const maxFull = Math.max(1, options.fullMapCapacity)
  const pageTableRows = ceilDiv(maxFull, VSM_TABLES_PER_ROW)
  const pageTableSize: [number, number] = [
    VSM_TABLES_PER_ROW * VSM_LEVEL0_PAGES,
    pageTableRows * VSM_PAGE_TABLE_BLOCK_HEIGHT,
  ]
  // The page marks carry VSM_LOG2_PAGE mips.
  const markMips = VSM_LOG2_PAGE
  const flags = mipChain(pageTableSize[0], pageTableSize[1], markMips)

  const { coverMode, coverLocal, coverSize, coverMips } = coverLayout(options, maxFull)
  const masks = mipChain(coverSize[0], coverSize[1], coverMips)

  const mapSlots = Math.min(
    1 << VSM_RECORD_MAP_ID_BITS,
    Math.max(VSM_MAPS_PAST_BLOCKS, options.mapSlotsPast ?? 0) + maxFull,
  )
  const hzbLayers = dynamicHzbOf(occlusion, cacheEnabled, options.dynamicHzb) ? 2 : 1

  return {
    poolPages,
    poolPagesXY: [POOL_PAGES_X, physicalPagesY],
    poolTexelsXY,
    poolRowShift: floorLog2(POOL_PAGES_X),
    poolRowMask: POOL_PAGES_X - 1,
    cacheEnabled,
    fullMapCapacity: maxFull,
    mapSlots,
    pageTableRows,
    pageTableSize,
    pageTableWords: pageTableSize[0] * pageTableSize[1],
    markMips,
    markMipOffsets: flags.offsets,
    markWordCount: flags.words,
    coverMode,
    coverLocal,
    coverSize,
    coverMips,
    coverMipOffsets: masks.offsets,
    coverWords: masks.words,
    pageRectCount: nextPow2(mapSlots * VSM_MIPS),
    occlusion,
    hzbLayers,
    hzbStaticLayer: hzbLayers - 1,
    pyramidSize: vsmPyramidSize(poolTexelsXY),
  }
}

/** The occlusion pyramid's level 0 for a pool of `poolTexels`: each side's power of two at or above
 *  it, halved, one texel at least. */
const vsmPyramidSize = ([x, y]: readonly [number, number]): [number, number] => [
  Math.max(nextPow2(x) >> 1, 1),
  Math.max(nextPow2(y) >> 1, 1),
]
