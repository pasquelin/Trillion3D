import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { clamp, clampLowWins } from '../../../math/src/scalar/reals.ts'
import { HAIR_STRANDS_RULES as RULES } from '../../../sdk-core/src/contracts/hairStrandsOptions.ts'
import { HAIR_TILE_CHUNK } from './rasterLimits.ts'

/** The settings of the compute raster (`hairVisibilityNaiveRaster`, `hairVisibilityTileCompaction`, `hairVisibilityClassification`, the sizes of
 *  its tiles and the number of groups of each of its passes): the project's, read each image. */
export interface HairRasterSettings {
  naive: boolean
  tileCompaction: boolean
  classification: boolean
  tileSize: number
  maxTiles: number
  numClassifiers: number
  numBinners: number
  numRasterizers: number
  numRasterizersNaive: number
}

/** The settings a project that sets none has: the reference's. */
export const HAIR_RASTER_DEFAULTS: HairRasterSettings = {
  naive: RULES.hairVisibilityNaiveRaster.default,
  tileCompaction: RULES.hairVisibilityTileCompaction.default,
  classification: RULES.hairVisibilityClassification.default,
  tileSize: RULES.hairVisibilityComputeRasterTileSize.default,
  maxTiles: RULES.hairVisibilityComputeRasterMaxTiles.default,
  numClassifiers: RULES.hairVisibilityNumClassifiers.default,
  numBinners: RULES.hairVisibilityComputeRasterNumBinners.default,
  numRasterizers: RULES.hairVisibilityComputeRasterNumRasterizers.default,
  numRasterizersNaive: RULES.hairVisibilityComputeRasterNumRasterizersNaive.default,
}

/** The lists the raster takes its segments from: the software share of the classification, its hardware share, or every segment
 *  (the values of the shader's `LIST`). */
export const HAIR_LIST_SOFTWARE = 0
export const HAIR_LIST_HARDWARE = 1
export const HAIR_LIST_ALL = 2
export type HairRasterList =
  typeof HAIR_LIST_SOFTWARE | typeof HAIR_LIST_HARDWARE | typeof HAIR_LIST_ALL

/**
 * WHAT THE COMPUTE RASTER RUNS, from its settings. The segments are drawn by the tiled raster (they are binned into the tiles of the image they
 * reach, the tiles optionally compacted, each tile then drawn by a group) unless `naive`, which draws them a thread a segment. With the
 * classification the segments are first split in two lists, the small ones (the software share) and the larger ones (the hardware share): the
 * larger ones are drawn a thread a segment, the group that follows sharing the largest, and the small ones by the tiled raster, or by the
 * naive one with `naive`. Without it every segment goes the one way.
 */
export interface HairRasterPlan {
  /** The lists drawn a thread a segment, in order. */
  readonly naive: readonly HairRasterList[]
  /** Whether the tiled raster draws the segments (from the software list with the classification, else all). */
  readonly tiles: boolean
  readonly compaction: boolean
  readonly classification: boolean
}

export function hairRasterPlan({
  naive,
  tileCompaction,
  classification,
}: HairRasterSettings): HairRasterPlan {
  const tiles = !naive
  const lists: HairRasterList[] = classification
    ? [HAIR_LIST_HARDWARE, ...(naive ? [HAIR_LIST_SOFTWARE as HairRasterList] : [])]
    : naive
      ? [HAIR_LIST_ALL]
      : []
  return {
    naive: lists,
    tiles,
    compaction: tiles && tileCompaction,
    classification,
  }
}

/** What picks the programs of a plan. */
export const hairRasterPlanKey = (plan: HairRasterPlan) =>
  `${plan.naive.join('')}|${plan.tiles}|${plan.compaction}|${plan.classification}`

const clampInt = (value: number, least: number, most: number) =>
  clamp(Math.floor(value), least, most)

/** The most tiles the raster may keep, and the most groups of each pass (the reference's bounds). */
export const HAIR_RASTER_BOUNDS = {
  tileSize: [8, 32],
  maxTiles: [1024, 262144],
  numClassifiers: [1, 256],
  numBinners: [1, 256],
  numRasterizers: [1, 1024],
  numRasterizersNaive: [1, 1024],
} as const

/** The sizes of what the compute raster works over for an image of `size`: its tile grid, the room of its buffers (held to what one binding of
 *  the device may be), and the groups of its passes. */
export interface HairRasterGeometry {
  readonly tileSize: number
  readonly shift: number
  readonly cells: readonly [number, number]
  readonly maxTiles: number
  readonly binners: number
  readonly rasterizers: number
  readonly rasterizersNaive: number
  readonly classifiers: number
  /** The words of each buffer: the grid, the tiles' words, their segments, and the list of the classified segments. */
  readonly gridWords: number
  readonly tileWords: number
  readonly primWords: number
  readonly listWords: number
  /** The room of the list of the classified segments (the most control points of an instance). */
  readonly listSize: number
}

export function hairRasterGeometry(
  settings: HairRasterSettings,
  plan: HairRasterPlan,
  size: readonly [number, number],
  points: number,
  bindingBytes: number,
): HairRasterGeometry {
  const { tileSize: tileBounds, maxTiles: tileCounts } = HAIR_RASTER_BOUNDS
  // The tiles are squares of a power of two: the reference runs only the one size, the groups of threads cover any up to 32 by 32.
  const shift = Math.floor(Math.log2(clampInt(settings.tileSize, ...tileBounds)))
  const tileSize = 2 ** shift
  const cells = [ceilDiv(size[0], tileSize), ceilDiv(size[1], tileSize)] as const
  const cellCount = cells[0] * cells[1]
  const room = Math.floor(bindingBytes / 4)
  const maxTiles = clampLowWins(
    clampInt(settings.maxTiles, ...tileCounts),
    1,
    Math.floor(room / HAIR_TILE_CHUNK),
  )
  const binners = clampLowWins(
    clampInt(settings.numBinners, ...HAIR_RASTER_BOUNDS.numBinners),
    1,
    Math.floor((room / cellCount - 1) / 5),
  )
  const listSize = plan.classification ? Math.max(points, 1) : 1
  return {
    tileSize,
    shift,
    cells,
    maxTiles,
    binners,
    rasterizers: clampInt(settings.numRasterizers, ...HAIR_RASTER_BOUNDS.numRasterizers),
    rasterizersNaive: clampInt(
      settings.numRasterizersNaive,
      ...HAIR_RASTER_BOUNDS.numRasterizersNaive,
    ),
    classifiers: clampInt(settings.numClassifiers, ...HAIR_RASTER_BOUNDS.numClassifiers),
    gridWords: plan.tiles ? cellCount * (1 + 5 * binners) : 1,
    tileWords: plan.tiles ? 4 + 4 * maxTiles : 1,
    primWords: plan.tiles ? maxTiles * HAIR_TILE_CHUNK : 1,
    listWords: 2 + listSize,
    listSize,
  }
}

/** The words of the parameters block (`TileParams` in the shader) for an image of `size`. */
export function writeHairRasterParams(
  words: Uint32Array,
  geometry: HairRasterGeometry,
  plan: HairRasterPlan,
  size: readonly [number, number],
) {
  words[0] = size[0]
  words[1] = size[1]
  words[2] = plan.tiles ? geometry.cells[0] : 0
  words[3] = plan.tiles ? geometry.cells[1] : 0
  words[4] = geometry.shift
  words[5] = geometry.tileSize
  words[6] = geometry.binners
  words[7] = geometry.rasterizers
  words[8] = geometry.rasterizersNaive
  words[9] = geometry.classifiers
  words[10] = geometry.maxTiles
  words[11] = geometry.listSize
}
export const HAIR_RASTER_PARAM_WORDS = 12
