import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { HAIR_RASTER_BOUNDS, type HairRasterSettings } from '../rasterModes.ts'

/**
 * THE FORWARD RASTER OF THE STRANDS (`hairVisibilityComputeRasterForward`): the sizes its passes agree on. The
 * strands' control points are lit once; their segments are binned into tiles of 32 pixels (`FORWARD_BIN_TILE`),
 * each tile a list of up to 1024 segments (`FORWARD_TILE_PRIMS`), the lists of one tile gathered and ordered by
 * depth, then shaded by workgroups that take one tile of 8 pixels at a time (`FORWARD_RASTER_TILE`).
 */
export const FORWARD_BIN_TILE = 32
export const FORWARD_RASTER_TILE = 8
/** The segments one list of a tile holds, and the lists a tile of pixels is shaded from at most, the nearest ones. */
export const FORWARD_TILE_PRIMS = 1024
export const FORWARD_TILE_LISTS = 64
/** The threads of the workgroups that bin and gather (the guaranteed 256 a workgroup holds); each takes `FORWARD_TILE_PRIMS / FORWARD_THREADS` segments of a list. */
export const FORWARD_THREADS = 256
/** The segments one thread of a rasterizer draws at a time, and the tiles of pixels a workgroup draws before it takes none more. */
export const FORWARD_SEGMENT_BATCH = 32
export const FORWARD_MAX_WORK = 4096
/** The steps of the walk of a segment over the tiles (a segment reaches no more of them). */
export const FORWARD_WALK_STEPS = 256
/** The buckets the segments of a tile are ordered into by depth: when gathered, and when shaded. */
export const FORWARD_GATHER_BUCKETS = 1024
export const FORWARD_SHADE_BUCKETS = 64
/** The coverage from which a pixel is complete and takes no more segment. */
export const FORWARD_COMPLETE_COVERAGE = 0.95

/** The words of a list of tiles: the segments it holds, its tile's coordinates, the first segment of the tile this list holds, and the depth range. */
export const FORWARD_TILE = { count: 0, coord: 1, firstWrite: 2, depth: 3, words: 4 } as const

/** The counters, one buffer: the lists binned, the lists gathered, the tiles to shade, and the tiles taken by the depth raster and by the colour raster. */
export const FORWARD_COUNTER = {
  binned: 0,
  gathered: 1,
  work: 2,
  depthTaken: 3,
  colorTaken: 4,
  words: 8,
} as const

/** The layers of the binners' grid, each `numBinners` deep, a layer a binner: the segments counted, the segments written, the list being filled, the list
 *  before it, the least depth value and the greatest (the least stored inverted, so a cleared grid holds the greatest). */
export const FORWARD_LAYER = {
  counted: 0,
  written: 1,
  current: 2,
  previous: 3,
  minDepth: 4,
  maxDepth: 5,
  count: 6,
} as const

/** The sizes a view's forward raster is made for. */
export interface ForwardLayout {
  /** The tiles of 32 pixels of the image, and of 8. */
  readonly binRes: readonly [number, number]
  readonly rasterRes: readonly [number, number]
  readonly numBinners: number
  readonly numRasterizers: number
  /** The lists of tiles the buffers hold, and the segments of all of them. */
  readonly maxTiles: number
  readonly primWords: number
  /** The words of the binners' grid (its layers, then the furthest opaque depth of each tile). */
  readonly gridWords: number
}

/** The settings the layout is made of (`hairVisibilityComputeRaster*`, the compute raster's own). */
export type ForwardSettings = Pick<HairRasterSettings, 'numBinners' | 'numRasterizers' | 'maxTiles'>

const clampInt = (value: number, low: number, high: number) =>
  Math.min(Math.max(Math.floor(value), low), high)

/** The words of the binners' grid for `tiles` tiles of 32 pixels and `numBinners` binners. */
const forwardGridWords = (tiles: number, numBinners: number) =>
  (FORWARD_LAYER.count * numBinners + 1) * tiles

/**
 * The layout of the forward raster for an image of `size`: the binners (1 to 256), the rasterizers (1 to 1024) and the lists of tiles
 * (1024 to 262144) the settings ask, the lists held to what one binding of `bindingBytes` holds of segments. None where a side of the image
 * is more than 2^16 tiles of 32 pixels wide (a tile's coordinates are two halves of a word).
 */
export function forwardLayout(
  size: readonly [number, number],
  settings: ForwardSettings,
  bindingBytes: number,
): ForwardLayout | undefined {
  const binRes = [ceilDiv(size[0], FORWARD_BIN_TILE), ceilDiv(size[1], FORWARD_BIN_TILE)] as const
  if (binRes[0] > 0xffff || binRes[1] > 0xffff || binRes[0] < 1 || binRes[1] < 1) return undefined
  const fits = Math.floor(bindingBytes / (FORWARD_TILE_PRIMS * 4))
  const maxTiles = Math.min(clampInt(settings.maxTiles, ...HAIR_RASTER_BOUNDS.maxTiles), fits)
  if (maxTiles < 1) return undefined
  const numBinners = clampInt(settings.numBinners, ...HAIR_RASTER_BOUNDS.numBinners)
  return {
    binRes,
    rasterRes: [ceilDiv(size[0], FORWARD_RASTER_TILE), ceilDiv(size[1], FORWARD_RASTER_TILE)],
    numBinners,
    numRasterizers: clampInt(settings.numRasterizers, ...HAIR_RASTER_BOUNDS.numRasterizers),
    maxTiles,
    primWords: maxTiles * FORWARD_TILE_PRIMS,
    gridWords: forwardGridWords(binRes[0] * binRes[1], numBinners),
  }
}

/** The control points the drawn instances make, the samples the forward raster lights. */
export const forwardNodeCount = (
  members: readonly { readonly group: { readonly pointCount: number } }[],
) => members.reduce((sum, { group }) => sum + group.pointCount, 0)
