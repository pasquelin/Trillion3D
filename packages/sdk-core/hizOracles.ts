/** Standard Hi-Z uses far = 1 and max reduction. Reversed-Z uses far = 0 and min reduction. */
export const HIZ_BACKGROUND = 1;

/** Réduction pyramidale Hi-Z conservatrice (plafond 2x2).
 *  Témoin indépendant de `hizBuildFlat` (hizPyramidFlat.ts) : les deux écritures de la même
 *  réduction sont ce que le test d'équivalence oppose, les fusionner supprimerait la preuve. */
export function hizReduceCeil(
  depth: readonly (readonly number[])[],
  reversedZ = false,
): number[][] {
  const height = depth.length;
  const width = height > 0 ? depth[0].length : 0;
  if (width === 0 || depth.some((row) => row.length !== width)) {
    throw new Error('Image vide ou non rectangulaire');
  }
  const result: number[][] = [];
  for (let startRow = 0; startRow < height; startRow += 2) {
    const row: number[] = [];
    for (let startCol = 0; startCol < width; startCol += 2) {
      let candidate = reversedZ ? Infinity : -Infinity;
      for (let r = startRow; r < Math.min(startRow + 2, height); r++) {
        for (let c = startCol; c < Math.min(startCol + 2, width); c++) {
          const v = depth[r][c];
          candidate = reversedZ ? Math.min(candidate, v) : Math.max(candidate, v);
        }
      }
      row.push(candidate);
    }
    result.push(row);
  }
  return result;
}

/** Full ceil-2×2 pyramid. Level 0 is the source depth; the last level is 1×1. */
export function hizBuildPyramid(
  depth: readonly (readonly number[])[],
  reversedZ = false,
): number[][][] {
  const levels: number[][][] = [depth.map((row) => [...row])];
  while (levels[levels.length - 1].length > 1 || levels[levels.length - 1][0].length > 1) {
    levels.push(hizReduceCeil(levels[levels.length - 1], reversedZ));
  }
  return levels;
}

/**
 * Farthest occluder depth covering the half-open level-0 pixel rectangle [x0,x1)×[y0,y1).
 * Empty or out-of-range rectangles return the background so they cannot hide anything.
 */
export function hizFootprintFar(
  pyramid: readonly (readonly (readonly number[])[])[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  level: number,
  reversedZ = false,
): number {
  if (level < 0 || level >= pyramid.length || x1 <= x0 || y1 <= y0) {
    return reversedZ ? 0 : HIZ_BACKGROUND;
  }
  const image = pyramid[level];
  const height = image.length;
  const width = height > 0 ? image[0].length : 0;
  if (width === 0) return reversedZ ? 0 : HIZ_BACKGROUND;
  const scale = 2 ** level;
  const minX = Math.floor(x0 / scale);
  const maxX = Math.floor((x1 - 1) / scale);
  const minY = Math.floor(y0 / scale);
  const maxY = Math.floor((y1 - 1) / scale);
  let far = reversedZ ? Infinity : -Infinity;
  let hit = false;
  for (let y = minY; y <= maxY; y++) {
    if (y < 0 || y >= height) continue;
    const row = image[y];
    for (let x = minX; x <= maxX; x++) {
      if (x < 0 || x >= width) continue;
      const v = row[x];
      far = reversedZ ? Math.min(far, v) : Math.max(far, v);
      hit = true;
    }
  }
  if (!hit) return reversedZ ? 0 : HIZ_BACKGROUND;
  return far;
}

/** Standard: hide iff nearest > far + bias. Reversed-Z: hide iff nearest < far - bias. */
export function hizOccluded(nearest: number, far: number, bias = 0, reversedZ = false): boolean {
  if (!Number.isFinite(nearest) || !Number.isFinite(far) || !Number.isFinite(bias) || bias < 0)
    return false;
  return reversedZ ? nearest < far - bias : nearest > far + bias;
}
