import { ceilDiv } from '../../../math/src/scalar/integers.ts'
/**
 * Value returned when no texels are read: cannot occlude anything.
 *
 * Engine depth is REVERSED — near is 1, far is 0 (`../../../math/src/projection/camera.ts`). A bounding box is occluded
 * only if its nearest depth bound is FARTHER (smaller value) than the occluder depth.
 */
export const HIZ_NOTHING = Number.NEGATIVE_INFINITY

/**
 * The per-frame Hi-Z pyramid: a single `Float32Array` for all levels, one offset
 * and size per level. Values are those from the visbuffer, already in single precision, and
 * reduction keeps the FARTHEST of a 2x2 quad — a minimum, engine depth being
 * reversed: nothing is rounded, the flat layout returns exactly what the nested
 * array pyramid returned, without allocating one line per row and frame.
 *
 * Production mirror of `hizReduceCeil` (`oracles.fixture.ts`), which remains the oracle: two
 * deliberate implementations of the same reduction, pitted against each other in equivalence test.
 */
export type HizFlat = {
  /** Every level's depths. */
  data: Float32Array
  /** Where each level starts. */
  offsets: Int32Array
  /** Each level's width. */
  widths: Int32Array
  /** Each level's height. */
  heights: Int32Array
  /** How many levels. */
  count: number
}

/** Level count of an image: the last level is 1x1. */
export function hizFlatLevels(width: number, height: number) {
  let w = width,
    h = height,
    count = 1
  while (w > 1 || h > 1) {
    w = ceilDiv(w, 2)
    h = ceilDiv(h, 2)
    count++
  }
  return count
}

/** Lays out (or relays out) offsets and sizes. `into` is reused as is if it already fits. */
export function hizFlatLayout(width: number, height: number, into?: HizFlat): HizFlat {
  if (width < 1 || height < 1) throw new Error('HIZ_DEPTH_SIZE')
  if (into && into.count && into.widths[0] === width && into.heights[0] === height) return into
  const count = hizFlatLevels(width, height)
  const offsets = new Int32Array(count),
    widths = new Int32Array(count),
    heights = new Int32Array(count)
  let w = width,
    h = height,
    total = 0
  for (let level = 0; level < count; level++) {
    offsets[level] = total
    widths[level] = w
    heights[level] = h
    total += w * h
    w = ceilDiv(w, 2)
    h = ceilDiv(h, 2)
  }
  const data = into && into.data.length >= total ? into.data : new Float32Array(Math.max(1, total))
  if (into) {
    into.data = data
    into.offsets = offsets
    into.widths = widths
    into.heights = heights
    into.count = count
    return into
  }
  return { data, offsets, widths, heights, count }
}

/**
 * 2x2 ceil reduction, level by level, into the pre-allocated buffer: the farthest (`Math.min`) of
 * each quad, NaN propagating. `Math.min` is exact, commutative and associative on every input
 * (NaN absorbs, −0 < +0), so the interior quads — four texels, no bound to test — take the min of
 * two pairs, and the odd last column and row the generic loop from `Infinity`: the same values.
 */
function reduire(pyramid: HizFlat, level: number) {
  const { data, offsets, widths, heights } = pyramid
  const srcWidth = widths[level - 1],
    srcHeight = heights[level - 1],
    src = offsets[level - 1]
  const width = widths[level],
    height = heights[level],
    dst = offsets[level]
  const fullWidth = srcWidth >> 1,
    fullHeight = srcHeight >> 1
  for (let y = 0; y < fullHeight; y++) {
    const top = src + 2 * y * srcWidth,
      bottom = top + srcWidth,
      out = dst + y * width
    for (let x = 0, c = 0; x < fullWidth; x++, c += 2)
      data[out + x] = Math.min(
        Math.min(data[top + c], data[top + c + 1]),
        Math.min(data[bottom + c], data[bottom + c + 1]),
      )
  }
  for (let y = 0; y < height; y++) {
    const startRow = y * 2,
      lastRow = startRow + 2 < srcHeight ? startRow + 2 : srcHeight
    for (let x = y < fullHeight ? fullWidth : 0; x < width; x++) {
      const startCol = x * 2,
        lastCol = startCol + 2 < srcWidth ? startCol + 2 : srcWidth
      let candidate = Infinity
      for (let r = startRow; r < lastRow; r++)
        for (let c = startCol; c < lastCol; c++)
          candidate = Math.min(candidate, data[src + r * srcWidth + c])
      data[dst + y * width + x] = candidate
    }
  }
}

/** Complete pyramid from visbuffer depth. `into` is rewritten, never reallocated. */
export function hizBuildFlat(
  depth: ArrayLike<number>,
  width: number,
  height: number,
  into?: HizFlat,
): HizFlat {
  if (depth.length < width * height) throw new Error('HIZ_DEPTH_SIZE')
  const pyramid = hizFlatLayout(width, height, into)
  const { data } = pyramid
  const n = width * height
  if (depth instanceof Float32Array) data.set(depth.subarray(0, n))
  else for (let i = 0; i < n; i++) data[i] = depth[i]
  for (let level = 1; level < pyramid.count; level++) reduire(pyramid, level)
  return pyramid
}
