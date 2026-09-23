import { HIZ_NOTHING } from './oracles.ts';

/**
 * The per-frame Hi-Z pyramid: a single `Float32Array` for all levels, one offset
 * and size per level. Values are those from the visbuffer, already in single precision, and
 * reduction keeps the FARTHEST of a 2x2 quad — a minimum, engine depth being
 * reversed: nothing is rounded, the flat layout returns exactly what the nested
 * array pyramid returned, without allocating one line per row and frame.
 *
 * Production mirror of `hizReduceCeil` (oracles.ts), which remains the oracle: two
 * deliberate implementations of the same reduction, pitted against each other in equivalence test.
 */
export type HizFlat = {
  data: Float32Array;
  offsets: Int32Array;
  widths: Int32Array;
  heights: Int32Array;
  count: number;
};

/** Level count of an image: the last level is 1x1. */
export function hizFlatLevels(width: number, height: number) {
  let w = width,
    h = height,
    count = 1;
  while (w > 1 || h > 1) {
    w = Math.ceil(w / 2);
    h = Math.ceil(h / 2);
    count++;
  }
  return count;
}

/** Lays out (or relays out) offsets and sizes. `into` is reused as is if it already fits. */
export function hizFlatLayout(width: number, height: number, into?: HizFlat): HizFlat {
  if (width < 1 || height < 1) throw new Error('HIZ_DEPTH_SIZE');
  if (into && into.count && into.widths[0] === width && into.heights[0] === height) return into;
  const count = hizFlatLevels(width, height);
  const offsets = new Int32Array(count),
    widths = new Int32Array(count),
    heights = new Int32Array(count);
  let w = width,
    h = height,
    total = 0;
  for (let level = 0; level < count; level++) {
    offsets[level] = total;
    widths[level] = w;
    heights[level] = h;
    total += w * h;
    w = Math.ceil(w / 2);
    h = Math.ceil(h / 2);
  }
  const data = into && into.data.length >= total ? into.data : new Float32Array(Math.max(1, total));
  if (into) {
    into.data = data;
    into.offsets = offsets;
    into.widths = widths;
    into.heights = heights;
    into.count = count;
    return into;
  }
  return { data, offsets, widths, heights, count };
}

/**
 * 2x2 ceil reduction, level by level, into the pre-allocated buffer. Candidate starts at `Infinity`
 * and passes through `Math.min`: NaN propagates as before.
 */
function reduire(pyramid: HizFlat, level: number) {
  const { data, offsets, widths, heights } = pyramid;
  const srcWidth = widths[level - 1],
    srcHeight = heights[level - 1],
    src = offsets[level - 1];
  const width = widths[level],
    height = heights[level],
    dst = offsets[level];
  for (let y = 0; y < height; y++) {
    const startRow = y * 2,
      lastRow = startRow + 2 < srcHeight ? startRow + 2 : srcHeight;
    for (let x = 0; x < width; x++) {
      const startCol = x * 2,
        lastCol = startCol + 2 < srcWidth ? startCol + 2 : srcWidth;
      let candidate = Infinity;
      for (let r = startRow; r < lastRow; r++)
        for (let c = startCol; c < lastCol; c++)
          candidate = Math.min(candidate, data[src + r * srcWidth + c]);
      data[dst + y * width + x] = candidate;
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
  if (depth.length < width * height) throw new Error('HIZ_DEPTH_SIZE');
  const pyramid = hizFlatLayout(width, height, into);
  const { data } = pyramid;
  for (let i = 0, n = width * height; i < n; i++) data[i] = depth[i];
  for (let level = 1; level < pyramid.count; level++) reduire(pyramid, level);
  return pyramid;
}

/**
 * Farthest occluder depth over the half-open level-0 pixel rectangle
 * [x0,x1)x[y0,y1). Empty or out-of-field rectangle: `HIZ_NOTHING`, which cannot hide anything.
 */
export function hizFootprintFarFlat(
  pyramid: HizFlat,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  level: number,
): number {
  if (level < 0 || level >= pyramid.count || x1 <= x0 || y1 <= y0) return HIZ_NOTHING;
  const width = pyramid.widths[level],
    height = pyramid.heights[level],
    base = pyramid.offsets[level],
    data = pyramid.data;
  if (width === 0) return HIZ_NOTHING;
  const scale = 2 ** level;
  const minX = Math.floor(x0 / scale),
    maxX = Math.floor((x1 - 1) / scale);
  const minY = Math.floor(y0 / scale),
    maxY = Math.floor((y1 - 1) / scale);
  let far = Infinity,
    hit = false;
  for (let y = minY; y <= maxY; y++) {
    if (y < 0 || y >= height) continue;
    const row = base + y * width;
    for (let x = minX; x <= maxX; x++) {
      if (x < 0 || x >= width) continue;
      far = Math.min(far, data[row + x]);
      hit = true;
    }
  }
  if (!hit) return HIZ_NOTHING;
  return far;
}
