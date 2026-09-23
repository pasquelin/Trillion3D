/**
 * Value returned when no texels are read: cannot occlude anything.
 *
 * Engine depth is REVERSED — near is 1, far is 0 (`../math/primitives/camera.ts`). A bounding box is occluded
 * only if its nearest depth bound is FARTHER (smaller value) than the occluder depth.
 */
export const HIZ_NOTHING = Number.NEGATIVE_INFINITY;

/** Conservative Hi-Z pyramid reduction: FARTHEST depth of a 2×2 quad (minimum value in reversed depth). */
export function hizReduceCeil(depth: readonly (readonly number[])[]): number[][] {
  const height = depth.length;
  const width = height > 0 ? depth[0].length : 0;
  if (width === 0 || depth.some((row) => row.length !== width)) {
    throw new Error('Empty or non-rectangular image');
  }
  const result: number[][] = [];
  for (let startRow = 0; startRow < height; startRow += 2) {
    const row: number[] = [];
    for (let startCol = 0; startCol < width; startCol += 2) {
      let candidate = Infinity;
      for (let r = startRow; r < Math.min(startRow + 2, height); r++) {
        for (let c = startCol; c < Math.min(startCol + 2, width); c++) {
          candidate = Math.min(candidate, depth[r][c]);
        }
      }
      row.push(candidate);
    }
    result.push(row);
  }
  return result;
}

/** Full ceil-2×2 pyramid. Level 0 is the source depth; the last level is 1×1. */
export function hizBuildPyramid(depth: readonly (readonly number[])[]): number[][][] {
  const levels: number[][][] = [depth.map((row) => [...row])];
  while (levels[levels.length - 1].length > 1 || levels[levels.length - 1][0].length > 1) {
    levels.push(hizReduceCeil(levels[levels.length - 1]));
  }
  return levels;
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
  if (level < 0 || level >= pyramid.length || x1 <= x0 || y1 <= y0) return HIZ_NOTHING;
  const image = pyramid[level];
  const height = image.length;
  const width = height > 0 ? image[0].length : 0;
  if (width === 0) return HIZ_NOTHING;
  const scale = 2 ** level;
  const minX = Math.floor(x0 / scale);
  const maxX = Math.floor((x1 - 1) / scale);
  const minY = Math.floor(y0 / scale);
  const maxY = Math.floor((y1 - 1) / scale);
  let far = Infinity;
  let hit = false;
  for (let y = minY; y <= maxY; y++) {
    if (y < 0 || y >= height) continue;
    const row = image[y];
    for (let x = minX; x <= maxX; x++) {
      if (x < 0 || x >= width) continue;
      far = Math.min(far, row[x]);
      hit = true;
    }
  }
  if (!hit) return HIZ_NOTHING;
  return far;
}

/** Reversed depth: box is occluded if its nearest bound is still behind
 *  the farthest occluder of its footprint, including margin. */
export function hizOccluded(nearest: number, far: number, bias = 0): boolean {
  if (!Number.isFinite(nearest) || !Number.isFinite(far) || !Number.isFinite(bias) || bias < 0)
    return false;
  return nearest < far - bias;
}
