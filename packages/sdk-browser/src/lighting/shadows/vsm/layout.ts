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
  VSM_MAX_SINGLE_PAGE_MAPS,
  VSM_RECORD_MAP_COUNT,
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

/** The receiver cover masks a set makes, in the order of what they hold: none (a 1x1 stand-in for
 *  the absent mask), the suns' maps', every map's (the local lights' too). */
const VSM_COVER_MODES = ['none', 'suns', 'all'] as const
export type VsmCoverMode = (typeof VSM_COVER_MODES)[number]
/** Whether a cover made for `held` holds what one made for `asked` does. */
/** The receiver cover the receiver-mask settings ask (`shadowUseReceiverMaskLocal`, `shadowUseReceiverMaskDirectional`): every map's where
 *  the local one is on, the suns' where only the directional one is, none otherwise. */
const vsmCoverModeOf = (local: boolean, directional: boolean): VsmCoverMode =>
  local ? 'all' : directional ? 'suns' : 'none'

/** The cover mode the receiver-mask settings make, read through `read` (the frame's runtime, or the defaults for the memory
 *  budget): the one place the two settings are turned into a mode. */
export const vsmCoverModeOfSettings = (
  read: (key: 'shadowUseReceiverMaskLocal' | 'shadowUseReceiverMaskDirectional') => boolean,
): VsmCoverMode =>
  vsmCoverModeOf(read('shadowUseReceiverMaskLocal'), read('shadowUseReceiverMaskDirectional'))

export const vsmCoverHolds = (held: VsmCoverMode, asked: VsmCoverMode) =>
  VSM_COVER_MODES.indexOf(held) >= VSM_COVER_MODES.indexOf(asked)

export interface VsmResourceOptions {
  /** Physical pages of the pool, default 2048; rounded up to whole pool rows. */
  poolPages?: number
  /** Page-table blocks of 128 × 192: a map whose finest mip is 0 takes one, a coarser one a
   *  quarter or less (`tableBlocks.ts`). */
  fullMapCapacity: number
  /** Directional maps (clipmap levels), sizes the directional-only receiver cover. */
  sunMapCapacity?: number
  /** The receiver cover: none, the suns' maps' (`shadowUseReceiverMaskDirectional`) or every map's
   *  (`shadowUseReceiverMaskLocal`). */
  coverMode: VsmCoverMode
  /** Map slots past one a block: at least the default; more as the lights ask them, up to the ids
   *  a map takes (`VSM_RECORD_MAP_ID_BITS`). */
  mapSlotsPast?: number
  /** Separate static cache slice; default true (cache on). */
  cacheEnabled?: boolean
  /** The occlusion culling of the casters against the maps' depth pyramid (`shadowOcclusionCulling`):
   *  the pyramid and the tables it is read through are made with the set; default true. */
  occlusion?: boolean
  /** A second layer of that pyramid for the dynamic casters (`shadowDynamicHzb`), where the cache and
   *  the occlusion are on; default false. */
  dynamicHzb?: boolean
  /** The suns' clipmaps hold a prefiltered shadow of their far levels (`shadowPrefilteredDistant`):
   *  the filter's pools, lists and history are made with the set; default false. */
  prefilteredDistant?: boolean
  /** The shadows are classic shadow maps (`shadowVirtualEnable` off): the projection passes are those of the classic filter (`../classic/classicTraceWgsl.ts`), not the soft rays'; default false. */
  classic?: boolean
  /** The overdraw view is on (`virtual-shadow-map-overdraw`): the pool holds a slice past the two for the shadow raster's counts of draws a texel; default false. */
  overdraw?: boolean
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
  /** Whether the set holds the prefiltered distant shadow's buffers (`prefilteredDistant`). */
  prefilteredDistant: boolean
  /** Whether the projection passes filter classic shadow maps (`classic`). */
  classic: boolean
  /** Whether the pool holds the overdraw slice (`overdraw`). */
  overdraw: boolean
  /** The page-table blocks the suns' clipmap maps take at most, the first of the table
   *  (`tableBlocks.ts`): what the prefiltered shadow keeps of the previous frame. */
  sunMapSlots: number
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

/** Declared: the map slots a set holds unless the lights ask more (`mapSlotsPast`): the ids reserved for the maps of one page
 *  (`VSM_MAX_SINGLE_PAGE_MAPS`) and the records a frame may write for full maps past its blocks: a map whose finest mip is
 *  coarser than 0 takes a quarter of a block or less (`tableBlocks.ts`), so far lights take records, not table rows. Each is a
 *  projection record (304 B) of both frames. */
const VSM_MAPS_PAST_BLOCKS = VSM_MAX_SINGLE_PAGE_MAPS + 1024

/** The physical pool's row, in pages: one page-table row's width, a power of two. */
export const POOL_PAGES_X = Math.floor(VSM_TABLE_ROW_WIDTH / VSM_PAGE_TEXELS)
if (!isPow2(POOL_PAGES_X)) throw new Error('VSM: pool row must be a power of two pages')

/** The cover masks' size: directional maps take the first blocks (`tableBlocks.ts`), a full row only
 *  past one row, all the blocks with every map's (`'all'`); no cover a 1x1 stand-in for the absent
 *  mask. */
function coverLayout(coverMode: VsmCoverMode, maxFull: number, sunMaps: number) {
  if (coverMode === 'none') return { coverSize: [1, 1] as [number, number], coverMips: 1 }
  const required = coverMode === 'all' ? maxFull : sunMaps
  const rows = ceilDiv(required, VSM_TABLES_PER_ROW)
  const rowEntries = rows === 1 ? required : VSM_TABLES_PER_ROW
  return {
    coverSize: [2 * rowEntries * VSM_LEVEL0_PAGES, 2 * rows * VSM_PAGE_TABLE_BLOCK_HEIGHT] as [
      number,
      number,
    ],
    coverMips: VSM_LOG2_PAGE + 1,
  }
}

/** Whether the set holds the dynamic casters' own pyramid layer: the pyramid and a static slice to
 *  keep apart must be on (`occlusion`, `cacheEnabled`), and the layer asked (`dynamicHzb`). */
export const dynamicHzbOf = (occlusion: boolean, cacheEnabled: boolean, dynamicHzb?: boolean) =>
  occlusion && cacheEnabled && !!dynamicHzb

/** The physical pool: a fixed power-of-two row width, the height for the requested page count. */
function poolLayoutOf(pages: number | undefined) {
  const physicalPagesY = ceilDiv(Math.max(1, pages ?? VSM_POOL_PAGES), POOL_PAGES_X)
  const poolPages = POOL_PAGES_X * physicalPagesY
  const poolTexelsXY: [number, number] = [
    POOL_PAGES_X * VSM_PAGE_TEXELS,
    physicalPagesY * VSM_PAGE_TEXELS,
  ]
  return { poolPages, physicalPagesY, poolTexelsXY }
}

/** The page table: `VSM_TABLES_PER_ROW` blocks a row, one block at least. */
function pageTableOf(maxFull: number) {
  const pageTableRows = ceilDiv(maxFull, VSM_TABLES_PER_ROW)
  const pageTableSize: [number, number] = [
    VSM_TABLES_PER_ROW * VSM_LEVEL0_PAGES,
    pageTableRows * VSM_PAGE_TABLE_BLOCK_HEIGHT,
  ]
  return { pageTableRows, pageTableSize }
}

/** Pure sizing; no device needed: each pool slice is one buffer, bound whole
 *  (`poolSliceBytes`; the pages a device's binding holds, `vsmPoolPagesBound`). */
export function vsmLayout(options: VsmResourceOptions): VsmLayout {
  const cacheEnabled = options.cacheEnabled ?? true,
    occlusion = options.occlusion ?? true
  const { poolPages, physicalPagesY, poolTexelsXY } = poolLayoutOf(options.poolPages)
  const maxFull = Math.max(1, options.fullMapCapacity)
  const { pageTableRows, pageTableSize } = pageTableOf(maxFull)
  // The page marks carry VSM_LOG2_PAGE mips.
  const markMips = VSM_LOG2_PAGE
  const flags = mipChain(pageTableSize[0], pageTableSize[1], markMips)

  const sunMaps = Math.max(1, options.sunMapCapacity ?? maxFull)
  const { coverMode } = options
  const { coverSize, coverMips } = coverLayout(coverMode, maxFull, sunMaps)
  const masks = mipChain(coverSize[0], coverSize[1], coverMips)

  const mapSlots = Math.min(
    VSM_RECORD_MAP_COUNT,
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
    coverSize,
    coverMips,
    coverMipOffsets: masks.offsets,
    coverWords: masks.words,
    pageRectCount: nextPow2(mapSlots * VSM_MIPS),
    occlusion,
    hzbLayers,
    hzbStaticLayer: hzbLayers - 1,
    pyramidSize: vsmPyramidSize(poolTexelsXY),
    prefilteredDistant: options.prefilteredDistant ?? false,
    classic: options.classic ?? false,
    overdraw: options.overdraw ?? false,
    sunMapSlots: Math.min(maxFull, sunMaps),
  }
}

/** The occlusion pyramid's level 0 for a pool of `poolTexels`: each side's power of two at or above
 *  it, halved, one texel at least. */
const vsmPyramidSize = ([x, y]: readonly [number, number]): [number, number] => [
  Math.max(nextPow2(x) >> 1, 1),
  Math.max(nextPow2(y) >> 1, 1),
]
