/**
 * The Hi-Z references the tests and the CPU oracles hold the engine to: a nested-array pyramid of
 * any layer — the farthest the occlusion reads (`hizReduceCeil`, of the occluders' depth), the
 * nearest the readers of the whole depth read (`hizReduceNearestCeil`), and the farthest of the
 * finished depth they bound a cell with (`hizReduceCeil` again, of the other image) —, its
 * footprint read and the occlusion verdict.
 */

/**
 * Value returned when no texels are read: cannot occlude anything.
 *
 * Engine depth is REVERSED — near is 1, far is 0 (`../../../math/src/projection/camera.ts`). A
 * bounding box is occluded only if its nearest depth bound is FARTHER (smaller value) than the
 * occluder depth.
 */
export const HIZ_NOTHING = Number.NEGATIVE_INFINITY

/** The pixels `[first, end)` a cell of `level` holds over an image `size` pixels across: its
 *  `2^level` block clipped to the image, and, as the first level's gather takes the image's last
 *  two pixels, the cell of that last square also the one before it. The one rule of a cell's start. */
export function hizCellSpan(cell: number, level: number, size: number): [number, number] {
  return [
    Math.min(cell * 2 ** level, Math.max(size, 2) - 2),
    Math.min((cell + 1) * 2 ** level, size),
  ]
}

/** The first texel of the square of the cell `cell` over `size` texels: `2·cell`, or, where `gather`
 *  (the first level's 2×2 gather, which never reads past the image), the start of the cell's span
 *  (`hizCellSpan`), one texel back where the last square would be a half one. */
export const hizSquareStart = (cell: number, size: number, gather: boolean) =>
  gather ? hizCellSpan(cell, 1, size)[0] : 2 * cell

/** One ceil-2×2 reduction of `depth` by `bound`, each square's texels in reading order. */
function reduceCeil(
  depth: readonly (readonly number[])[],
  bound: (a: number, b: number) => number,
  start: number,
  gather: boolean,
): number[][] {
  const height = depth.length
  const width = height > 0 ? depth[0].length : 0
  if (width === 0 || depth.some((row) => row.length !== width)) {
    throw new Error('Empty or non-rectangular image')
  }
  const result: number[][] = []
  for (let cy = 0; 2 * cy < height; cy++) {
    const startRow = hizSquareStart(cy, height, gather)
    const row: number[] = []
    for (let cx = 0; 2 * cx < width; cx++) {
      const startCol = hizSquareStart(cx, width, gather)
      let candidate = start
      for (let r = startRow; r < Math.min(startRow + 2, height); r++) {
        for (let c = startCol; c < Math.min(startCol + 2, width); c++) {
          candidate = bound(candidate, depth[r][c])
        }
      }
      row.push(candidate)
    }
    result.push(row)
  }
  return result
}

/** Conservative Hi-Z pyramid reduction: FARTHEST depth of a 2×2 quad (minimum value in reversed
 *  depth). `gather` is the first level's, read from the depth itself: the last odd column or row
 *  takes the image's last two texels, not one. */
export const hizReduceCeil = (depth: readonly (readonly number[])[], gather = false) =>
  reduceCeil(depth, Math.min, Infinity, gather)

/** The nearest layer's reduction: NEAREST depth of a 2×2 quad (maximum value in reversed depth),
 *  what a ray in front of a cell passes everything under. */
export const hizReduceNearestCeil = (depth: readonly (readonly number[])[], gather = false) =>
  reduceCeil(depth, Math.max, -Infinity, gather)

/** Full ceil-2×2 pyramid by `reduce` (the farthest by default). Level 0 is the source depth, level
 *  1 its `gather` reduction; the last level is 1×1. */
export function hizBuildPyramid(
  depth: readonly (readonly number[])[],
  reduce: (depth: readonly (readonly number[])[], gather?: boolean) => number[][] = hizReduceCeil,
): number[][][] {
  const levels: number[][][] = [depth.map((row) => [...row])]
  while (levels[levels.length - 1].length > 1 || levels[levels.length - 1][0].length > 1) {
    levels.push(reduce(levels[levels.length - 1], levels.length === 1))
  }
  return levels
}

/**
 * Farthest occluder depth covering the half-open level-0 pixel rectangle [x0,x1)×[y0,y1).
 * Empty or out-of-range rectangles return `HIZ_NOTHING` so they cannot hide anything.
 */
export function hizFootprintFar(
  pyramid: readonly (readonly (readonly number[])[])[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  level: number,
): number {
  if (level < 0 || level >= pyramid.length || x1 <= x0 || y1 <= y0) return HIZ_NOTHING
  const image = pyramid[level]
  const height = image.length
  const width = height > 0 ? image[0].length : 0
  if (width === 0) return HIZ_NOTHING
  const scale = 2 ** level
  const minX = Math.floor(x0 / scale)
  const maxX = Math.floor((x1 - 1) / scale)
  const minY = Math.floor(y0 / scale)
  const maxY = Math.floor((y1 - 1) / scale)
  let far = Infinity
  let hit = false
  for (let y = minY; y <= maxY; y++) {
    if (y < 0 || y >= height) continue
    const row = image[y]
    for (let x = minX; x <= maxX; x++) {
      if (x < 0 || x >= width) continue
      far = Math.min(far, row[x])
      hit = true
    }
  }
  if (!hit) return HIZ_NOTHING
  return far
}

/** Reversed depth: box is occluded if its nearest bound is still behind
 *  the farthest occluder of its footprint, including margin. */
export function hizOccluded(nearest: number, far: number, bias = 0): boolean {
  if (!Number.isFinite(nearest) || !Number.isFinite(far) || !Number.isFinite(bias) || bias < 0)
    return false
  return nearest < far - bias
}
