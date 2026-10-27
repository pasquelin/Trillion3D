import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { clamp } from '../../../math/src/scalar/reals.ts'

/**
 * THE STRANDS' VISIBILITY, in numbers: what its passes share between the host and the shaders. The
 * visibility is a buffer of several samples a pixel that a compute raster fills with the nearest
 * strand at each sample (`rasterPass.ts`), compacted to the strands each pixel holds
 * (`compactionPass.ts`) in the tiles the strands touch (`tilesPass.ts`). The shaders are written
 * from these constants, never from numbers typed again.
 */

/** The pixels a tile spans a side. */
export const HAIR_TILE_SIZE = 8
/** The lists of tiles: those with any strand, those fully covered, those partly covered. A tile with
 *  no strand is in none. */
export const HAIR_TILE_ALL = 0
export const HAIR_TILE_FULL = 1
export const HAIR_TILE_PARTIAL = 2
export const HAIR_TILE_LISTS = 3
/** The words of the draw arguments (the vertices, the instances, the two first ones) and of the
 *  dispatch arguments (the groups a side) of one list of tiles. */
export const HAIR_DRAW_ARGS_WORDS = 4
export const HAIR_DISPATCH_ARGS_WORDS = 3
/** The byte offsets of the draw and of the dispatch over the list of all the tiles with strands, in
 *  their arguments' buffers. */
export const HAIR_ALL_TILES_DRAW = HAIR_TILE_ALL * HAIR_DRAW_ARGS_WORDS * 4
export const HAIR_ALL_TILES_DISPATCH = HAIR_TILE_ALL * HAIR_DISPATCH_ARGS_WORDS * 4
/** The vertices a tile is drawn with: two triangles. */
export const HAIR_TILE_VERTICES = 6

/** The formats of the textures of an image: the transmittance of the strands, a pixel's descriptor of
 *  its compacted samples, and the share of the pixel the strands cover. */
export const HAIR_TRANSMITTANCE_FORMAT: GPUTextureFormat = 'r32float'
export const HAIR_NODE_INDEX_FORMAT: GPUTextureFormat = 'r32uint'
export const HAIR_COVERAGE_FORMAT: GPUTextureFormat = 'r32float'
/** The format of the depth of the nearest strand of a pixel (`HAIR_ONLY_DEPTH`), zero for none. */
export const HAIR_ONLY_DEPTH_FORMAT: GPUTextureFormat = 'r32float'

/** The threads of the groups that go over the compacted samples one by one. */
export const HAIR_NODE_GROUP_SIZE = 64
/** The bits of a sample's identifier that hold the control point of its segment (a group holds
 *  `HAIR_STRANDS_MAX_POINTS_PER_GROUP` points, all of them), the eight above the material of its group:
 *  the identifier is one word of the two a sample holds, the depth's the other, so no bit is free. */
export const HAIR_ID_BITS = 24
/** The most instances an image draws: as many materials as the identifier's bits above the control
 *  point name. */
export const HAIR_MAX_DRAWN = 2 ** (32 - HAIR_ID_BITS)
/** The bits of a pixel's descriptor that hold the rank of its first sample; the six above hold how
 *  many it has. */
export const HAIR_NODE_OFFSET_BITS = 26
export const HAIR_NODE_OFFSET_MASK = 2 ** HAIR_NODE_OFFSET_BITS - 1
/** The most compacted samples an image places: as many as a descriptor's first rank names. */
export const HAIR_NODE_ROOM_MAX = HAIR_NODE_OFFSET_MASK + 1
/** The bits of a compacted sample's depth and of its coverage of the pixel's samples: its word holds
 *  the depth above and the coverage, a whole number below `HAIR_COVERAGE_STEPS`, below. */
const HAIR_DEPTH_BITS = 24
export const HAIR_DEPTH_SCALE = 2 ** HAIR_DEPTH_BITS - 1
export const HAIR_COVERAGE_BITS = 8
export const HAIR_COVERAGE_STEPS = 2 ** HAIR_COVERAGE_BITS
/** The bits of an x in the word that names a tile or a pixel, its y above. */
export const HAIR_COORD_BITS = 16
export const HAIR_COORD_MASK = 2 ** HAIR_COORD_BITS - 1
/** The counters of the compacted samples: how many were placed in all, past the room of the buffer
 *  included, and how many of those were stored. */
export const HAIR_NODE_COUNTER_PLACED = 0
export const HAIR_NODE_COUNTER_STORED = 1
export const HAIR_NODE_COUNTERS = 2

/** The sample counts of the visibility. */
export type HairSampleCount = 2 | 4 | 8

/**
 * The positions of the samples of a pixel, in sixteenths of a pixel from its centre, x to the right
 * and y down: the standard multisample pattern of each count.
 */
export const HAIR_SAMPLE_OFFSETS = {
  2: [
    [4, 4],
    [-4, -4],
  ],
  4: [
    [-2, -6],
    [6, -2],
    [-6, 2],
    [2, 6],
  ],
  8: [
    [1, -3],
    [-1, 3],
    [5, 1],
    [-3, -5],
    [-5, 5],
    [-7, -1],
    [3, 7],
    [7, -7],
  ],
} as const satisfies Record<HairSampleCount, readonly (readonly [number, number])[]>
/** The steps of a pixel the offsets are counted in. */
export const HAIR_SAMPLE_OFFSET_STEPS = 16

/** The count of samples a pixel holds for the setting `requested`: 2, 4 or 8, a value between taken
 *  as the next one up. */
export const hairSampleCount = (requested: number): HairSampleCount =>
  requested <= 2 ? 2 : requested <= 4 ? 4 : 8

/** The samples a pixel is given room for on average, of `count` at most, `mean` (0 to 1) their
 *  share; one at least. */
export const hairMeanSampleCount = (count: number, mean: number) =>
  Math.max(1, Math.floor(count * clamp(mean, 0, 1)))

/** The share of a pixel the samples of a count cut a strand's least diameter from (all of it for
 *  one sample a pixel, a half for 2 and 4 samples, a quarter for 8). */
const hairSubPixelShare = (samples: 1 | HairSampleCount) =>
  samples === 1 ? 1 : samples === 8 ? 4 / 16 : 8 / 16

/**
 * The least radius of a strand at a distance of 1 from the camera, in world units: half the
 * diameter, which is `scale` (`hairRasterizationScale`, or `hairStableRasterizationScale` for a groom
 * drawn stable) times the share of a pixel the samples cut from it (`hairSubPixelShare`) times the
 * size of a pixel at that distance (`pixelSize`).
 */
export const hairMinRadiusAtDepth1 = (
  pixelSize: number,
  samples: 1 | HairSampleCount,
  scale: number,
) => 0.5 * scale * hairSubPixelShare(samples) * pixelSize

/** The tiles of an image of `width` by `height` pixels: the count a side and in all. */
export function hairTileGrid(width: number, height: number) {
  const x = ceilDiv(width, HAIR_TILE_SIZE),
    y = ceilDiv(height, HAIR_TILE_SIZE)
  return { x, y, count: x * y }
}

/** Writes into `out` the tiles (`[x0, y0, x1, y1]`) that hold the pixels of `rect`. */
export function hairTileRect(
  out: [number, number, number, number],
  rect: readonly [number, number, number, number],
) {
  out[0] = Math.floor(rect[0] / HAIR_TILE_SIZE)
  out[1] = Math.floor(rect[1] / HAIR_TILE_SIZE)
  out[2] = ceilDiv(rect[2], HAIR_TILE_SIZE)
  out[3] = ceilDiv(rect[3], HAIR_TILE_SIZE)
  return out
}

/** The compacted samples a view is given room for: the pixels of `rect` (`[x0, y0, x1, y1]`) times
 *  the samples a pixel averages. */
export const hairNodeCapacity = (
  rect: readonly [number, number, number, number],
  samples: number,
) => (rect[2] - rect[0]) * (rect[3] - rect[1]) * samples

/**
 * Writes into `out` the rectangle that holds the screen rectangles (`[x0, y0, x1, y1]` each, held to
 * the image by whoever made them) of the `groups` that have members drawn; an empty one when there
 * are none. A group of members that only cast is drawn in no pixel.
 */
export function hairUnionRect(
  out: [number, number, number, number],
  groups: readonly {
    readonly screenRect: readonly [number, number, number, number]
    readonly members: readonly unknown[]
  }[],
) {
  out[0] = out[1] = out[2] = out[3] = 0
  let first = true
  for (const { screenRect: r, members } of groups) {
    if (!members.length) continue
    out[0] = first ? r[0] : Math.min(out[0], r[0])
    out[1] = first ? r[1] : Math.min(out[1], r[1])
    out[2] = first ? r[2] : Math.max(out[2], r[2])
    out[3] = first ? r[3] : Math.max(out[3], r[3])
    first = false
  }
  return out
}

/** The bytes of a sample, in the visibility buffer as compacted: two words, a strand's identifier and
 *  the word of its depth. */
export const HAIR_SAMPLE_BYTES = 8

/** The words of a compacted sample's material (`materialMath.ts`), and its bytes. */
export const HAIR_NODE_DATA_WORDS = 5
export const HAIR_NODE_DATA_BYTES = HAIR_NODE_DATA_WORDS * 4

/** The words of a band's window: its first row, one past its last, and the first word of the
 *  identifier plane of a device without the 64-bit word (the samples of the band, in words). */
export const HAIR_BAND_WORDS = 4

/**
 * THE BANDS OF THE SAMPLES. The visibility buffer holds `HAIR_SAMPLE_BYTES` for each sample of each
 * pixel; where that exceeds what a storage binding holds (`limit`), the buffer is cut in bands of
 * whole tiles of rows, one buffer each, as the float atlas cuts what a texture's side cannot hold
 * (`gpu/core/floatAtlas.ts`): the same values, a pixel's samples in the band its row lies in. The
 * rows of a band are the most whole tiles of rows that fit `limit` for an image `width` pixels wide;
 * 0 where not one tile of rows does.
 */
export const hairBandRows = (width: number, samples: number, limit: number) =>
  Math.floor(Math.floor(limit / (width * samples * HAIR_SAMPLE_BYTES)) / HAIR_TILE_SIZE) *
  HAIR_TILE_SIZE

/** The bands of an image `height` rows high cut in bands of `rows`: how many. */
export const hairBandCount = (height: number, rows: number) => ceilDiv(height, rows)

/** The bytes of band `k` of `count` of an image `width` by `height` of `samples` samples a pixel, cut
 *  in bands of `rows` rows: the last holds the rows that remain. */
export const hairBandBytes = (
  k: number,
  count: number,
  rows: number,
  width: number,
  height: number,
  samples: number,
) => (k === count - 1 ? height - rows * (count - 1) : rows) * width * samples * HAIR_SAMPLE_BYTES

/** Writes band `k`'s window (`HAIR_BAND_WORDS` words) into `out` at `at`, for an image `width` by
 *  `height` of `samples` samples a pixel, cut in bands of `rows` rows. */
export function writeHairBand(
  out: Uint32Array,
  at: number,
  k: number,
  rows: number,
  width: number,
  height: number,
  samples: number,
) {
  const first = k * rows,
    end = Math.min(height, first + rows)
  out[at] = first
  out[at + 1] = end
  out[at + 2] = (end - first) * width * samples
  out[at + 3] = 0
}
