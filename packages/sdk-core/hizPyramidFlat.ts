import { HIZ_BACKGROUND } from './hizOracles.ts';

/**
 * La pyramide Hi-Z du chemin par image : un seul `Float32Array` pour tous les niveaux, un décalage
 * et une taille par niveau. Les valeurs sont celles du visbuffer, déjà en simple précision, et la
 * réduction est un maximum : rien n'y est arrondi, la disposition plate rend exactement ce que
 * rendait la pyramide en tableaux de tableaux, sans allouer une ligne par rangée et par image.
 */
export type HizFlat = {
  data: Float32Array;
  offsets: Int32Array;
  widths: Int32Array;
  heights: Int32Array;
  count: number;
};

/** Nombre de niveaux d'une image : le dernier est 1×1. */
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

/** Pose (ou repose) les décalages et les tailles. `into` est réutilisé tel quel s'il tient déjà. */
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
 * Réduction plafond 2×2, niveau par niveau, dans le tampon déjà posé. Le candidat part de l'infini
 * du bon signe et passe par `Math.max`/`Math.min` comme avant : un NaN se propage à l'identique.
 */
function reduire(pyramid: HizFlat, level: number, reversedZ: boolean) {
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
      let candidate = reversedZ ? Infinity : -Infinity;
      for (let r = startRow; r < lastRow; r++)
        for (let c = startCol; c < lastCol; c++) {
          const v = data[src + r * srcWidth + c];
          candidate = reversedZ ? Math.min(candidate, v) : Math.max(candidate, v);
        }
      data[dst + y * width + x] = candidate;
    }
  }
}

/** Pyramide complète à partir de la profondeur du visbuffer. `into` est réécrit, jamais réalloué. */
export function hizBuildFlat(
  depth: ArrayLike<number>,
  width: number,
  height: number,
  into?: HizFlat,
  reversedZ = false,
): HizFlat {
  if (depth.length < width * height) throw new Error('HIZ_DEPTH_SIZE');
  const pyramid = hizFlatLayout(width, height, into);
  const { data } = pyramid;
  for (let i = 0, n = width * height; i < n; i++) data[i] = depth[i];
  for (let level = 1; level < pyramid.count; level++) reduire(pyramid, level, reversedZ);
  return pyramid;
}

/**
 * Profondeur de l'occulteur le plus lointain sur le rectangle de niveau 0 semi-ouvert
 * [x0,x1)×[y0,y1). Rectangle vide ou hors champ : le fond, qui ne peut rien cacher.
 */
export function hizFootprintFarFlat(
  pyramid: HizFlat,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  level: number,
  reversedZ = false,
): number {
  if (level < 0 || level >= pyramid.count || x1 <= x0 || y1 <= y0)
    return reversedZ ? 0 : HIZ_BACKGROUND;
  const width = pyramid.widths[level],
    height = pyramid.heights[level],
    base = pyramid.offsets[level],
    data = pyramid.data;
  if (width === 0) return reversedZ ? 0 : HIZ_BACKGROUND;
  const scale = 2 ** level;
  const minX = Math.floor(x0 / scale),
    maxX = Math.floor((x1 - 1) / scale);
  const minY = Math.floor(y0 / scale),
    maxY = Math.floor((y1 - 1) / scale);
  let far = reversedZ ? Infinity : -Infinity,
    hit = false;
  for (let y = minY; y <= maxY; y++) {
    if (y < 0 || y >= height) continue;
    const row = base + y * width;
    for (let x = minX; x <= maxX; x++) {
      if (x < 0 || x >= width) continue;
      const v = data[row + x];
      far = reversedZ ? Math.min(far, v) : Math.max(far, v);
      hit = true;
    }
  }
  if (!hit) return reversedZ ? 0 : HIZ_BACKGROUND;
  return far;
}
