import { clamp } from '../../../../math/src/scalar/reals.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'

/** The side in pixels of a tile the segments are binned into, of one a raster step covers, and the bytes of a packed segment. */
export const RENDER_CURVE_BIN_TILE_SIZE = 32
const RENDER_CURVE_RASTER_TILE_SIZE = 8
export const RENDER_CURVE_SEGMENT_BYTES = 16
/** The curves a cluster holds, the points a curve of a cluster holds at most, and the bytes of a cluster's header and of one of its points. */
export const RENDER_CURVE_CURVES_PER_CLUSTER = 64
export const RENDER_CURVE_MAX_POINTS_PER_CURVE = 16
export const RENDER_CURVE_CLUSTER_HEADER_BYTES = 32
export const RENDER_CURVE_CLUSTER_POINT_BYTES = 8
/** The words of an instance's record, the segments one entry of the tile data holds, the words of an entry (segment count, tile, first segment index it takes), and the layers of a binner's counts (segments, written, tile info, first index of a refused tile). */
export const RENDER_CURVE_INSTANCE_WORDS = 32
export const RENDER_CURVE_SEGMENTS_PER_ENTRY = 1024
export const RENDER_CURVE_ENTRY_WORDS = 3
export const RENDER_CURVE_BINNER_LAYERS = 4
/** The clusters a visible instance may name on average, and the most tile data entries (a tile info holds two indices of sixteen bits). */
export const RENDER_CURVE_CLUSTERS_PER_INSTANCE = 8 * 1024
const RENDER_CURVE_MAX_ENTRIES = 0xffff

/** The bytes of a cluster whose curves hold `pointsPerCurve` points. */
export const renderCurveClusterStride = (pointsPerCurve: number) =>
  RENDER_CURVE_CLUSTER_HEADER_BYTES +
  RENDER_CURVE_CURVES_PER_CLUSTER * pointsPerCurve * RENDER_CURVE_CLUSTER_POINT_BYTES

/** The sizes the curve raster pipeline works at for an image of `width` × `height` render pixels (`renderCurveCommon`). */
export interface RenderCurveCommon {
  readonly resolution: readonly [number, number]
  readonly numBinners: number
  readonly numRasterizers: number
  readonly binTileRes: readonly [number, number]
  readonly rasterTileRes: readonly [number, number]
  readonly maxTileDataCount: number
  /** The tile data entries that can be given out: those the segments' room holds, as many as a tile info names. */
  readonly maxTileAllocCount: number
  readonly maxSegmentDataCount: number
  readonly maxZBinDataCount: number
  readonly maxZBinSegmentDataCount: number
  readonly maxRasterWorkCount: number
  readonly minCoverageThreshold: number
}

/**
 * The sizes of the pipeline's shared block: the bin and raster tile counts, the binners and rasterizers
 * (`renderCurveRasterNumBinners` held to 1 to 256, `renderCurveRasterNumRasterizers` to 1 to 1024), the room for tile data and
 * segments a binner may fill (a tile holds at most `max(binners, 8)` times 128 segments in 2 tile entries each), the
 * z bins' and the raster work's, and the coverage under which a raster step stops (`renderCurveRasterMinCoverage`, 0 to 1).
 * `segmentCap`, the most segments a storage buffer of the device holds: the room for segments is held to it.
 */
export function renderCurveCommon(
  width: number,
  height: number,
  numBinners: number,
  numRasterizers: number,
  minCoverage: number,
  segmentCap: number,
): RenderCurveCommon {
  const binners = clamp(Math.trunc(numBinners), 1, 256)
  const rasterizers = clamp(Math.trunc(numRasterizers), 1, 1024)
  const binTileRes = [
    ceilDiv(width, RENDER_CURVE_BIN_TILE_SIZE),
    ceilDiv(height, RENDER_CURVE_BIN_TILE_SIZE),
  ] as const
  const rasterTileRes = [
    ceilDiv(width, RENDER_CURVE_RASTER_TILE_SIZE),
    ceilDiv(height, RENDER_CURVE_RASTER_TILE_SIZE),
  ] as const
  const tiles = binTileRes[0] * binTileRes[1]
  const maxTileDataCount = tiles * Math.max(binners, 8) * 2
  const maxSegmentDataCount = clamp(tiles * Math.max(binners, 8) * 128, 0, Math.max(segmentCap, 1))
  return {
    resolution: [width, height],
    numBinners: binners,
    numRasterizers: rasterizers,
    binTileRes,
    rasterTileRes,
    maxTileDataCount,
    maxTileAllocCount: Math.min(
      maxTileDataCount,
      RENDER_CURVE_MAX_ENTRIES,
      Math.floor(maxSegmentDataCount / RENDER_CURVE_SEGMENTS_PER_ENTRY),
    ),
    maxSegmentDataCount,
    maxZBinDataCount: maxTileDataCount,
    maxZBinSegmentDataCount: maxSegmentDataCount,
    maxRasterWorkCount: tiles,
    minCoverageThreshold: clamp(minCoverage, 0, 1),
  }
}
