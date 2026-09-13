/**
 * Oracles mathématiques et algorithmes de référence pour Web Geometry.
 * Référence pure TypeScript (sans DOM ni dépendances plateforme).
 */

/** Produit scalaire de deux vecteurs de même dimension. */
export function dot(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length) {
    throw new Error('Dimensions incompatibles');
  }
  let sum = 0;
  for (let i = 0; i < left.length; i++) {
    sum += left[i] * right[i];
  }
  return sum;
}

/**
 * Largest factor by which a 3x3 linear map can stretch a distance: its largest singular value,
 * obtained in closed form from the symmetric matrix A^T A. A rotation reports exactly 1.
 *
 * The cluster cut projects every screen error through this exact stretch, so a rotated instance is
 * refined against the pixel budget it actually asks for.
 *
 * `elements` is a column-major 4x4 as stored by a 3D library: indices 0,1,2 / 4,5,6 / 8,9,10.
 */
export function maxStretch(elements: readonly number[]): number {
  if (elements.length < 11) throw new Error('Matrice invalide');
  const a = elements[0], b = elements[4], c = elements[8];
  const d = elements[1], e = elements[5], f = elements[9];
  const g = elements[2], h = elements[6], i = elements[10];
  if (![a, b, c, d, e, f, g, h, i].every(Number.isFinite)) throw new Error('Matrice invalide');
  const m00 = a * a + d * d + g * g, m11 = b * b + e * e + h * h, m22 = c * c + f * f + i * i;
  const m01 = a * b + d * e + g * h, m02 = a * c + d * f + g * i, m12 = b * c + e * f + h * i;
  const offDiagonal = m01 * m01 + m02 * m02 + m12 * m12;
  if (offDiagonal <= 0) return Math.sqrt(Math.max(m00, m11, m22, 0));
  const mean = (m00 + m11 + m22) / 3;
  const spread = Math.sqrt((((m00 - mean) ** 2 + (m11 - mean) ** 2 + (m22 - mean) ** 2 + 2 * offDiagonal) / 6));
  if (!(spread > 0)) return Math.sqrt(Math.max(mean, 0));
  const b00 = (m00 - mean) / spread, b11 = (m11 - mean) / spread, b22 = (m22 - mean) / spread;
  const b01 = m01 / spread, b02 = m02 / spread, b12 = m12 / spread;
  const determinant = b00 * (b11 * b22 - b12 * b12) - b01 * (b01 * b22 - b12 * b02) + b02 * (b01 * b12 - b11 * b02);
  const angle = Math.acos(Math.min(1, Math.max(-1, determinant / 2))) / 3;
  return Math.sqrt(Math.max(mean + 2 * spread * Math.cos(angle), 0));
}

/**
 * Screen-pixel error of one cluster of a DAG cut.
 *
 * `error x stretch x focal / distance`, where the distance is measured from the eye to the nearest
 * point of the cluster's bounding sphere. No extra margin is added. The near plane is the single
 * conservative case: a sphere that reaches it reports Infinity, which refines.
 * A zero error projects to zero pixels everywhere, so exact geometry stays selectable even against
 * the near plane; an infinite error marks a cluster with no replacement, always selectable too.
 *
 * `centre` is the sphere centre in view space (eye at the origin); `radius` is in object space and
 * is stretched by the same factor as the error.
 */
export function clusterErrorPixels(
  clusterError: number,
  stretch: number,
  centreX: number,
  centreY: number,
  centreZ: number,
  radius: number,
  focal: number,
  near: number
): number {
  if (clusterError === 0) return 0;
  if (clusterError === Infinity) return Infinity;
  if (
    !Number.isFinite(clusterError) || clusterError < 0 ||
    !Number.isFinite(stretch) || stretch < 0 ||
    !Number.isFinite(radius) || radius < 0 ||
    !Number.isFinite(focal) || focal <= 0 ||
    !Number.isFinite(near) || near <= 0 ||
    !Number.isFinite(centreX) || !Number.isFinite(centreY) || !Number.isFinite(centreZ)
  ) {
    throw new Error('Parametres de cluster invalides');
  }
  const distance = Math.sqrt(centreX * centreX + centreY * centreY + centreZ * centreZ) - radius * stretch;
  if (!(distance > near)) return Infinity;
  return (clusterError * stretch * focal) / distance;
}

/** Rejet de cône normal pour le culling de faces arrière. */
export function coneRejects(axisDotView: number, angle: number, directionSpread = 0): boolean {
  if (
    axisDotView < -1 ||
    axisDotView > 1 ||
    angle < 0 ||
    angle > Math.PI ||
    directionSpread < 0 ||
    directionSpread > Math.PI
  ) {
    throw new Error('Cone invalide');
  }
  const totalAngle = angle + directionSpread;
  return totalAngle < Math.PI / 2 && axisDotView < -Math.sin(totalAngle);
}

/** Balayage préfixe exclusif (exclusive scan). */
export function exclusiveScan(values: readonly number[]): [number[], number] {
  const result: number[] = [];
  let total = 0;
  for (const v of values) {
    result.push(total);
    total += v;
  }
  return [result, total];
}

/** Compaction de données selon un tableau de prédicats binaires (0 ou 1). */
export function compact<T>(values: readonly T[], flags: readonly number[]): T[] {
  if (values.length !== flags.length || flags.some(f => f !== 0 && f !== 1)) {
    throw new Error('Predicats invalides');
  }
  const [offsets, total] = exclusiveScan(flags);
  const result: T[] = new Array(total);
  for (let i = 0; i < flags.length; i++) {
    if (flags[i]) {
      result[offsets[i]] = values[i];
    }
  }
  return result;
}

/** WebGPU drawIndirect (non-indexed): 16 bytes. Not drawIndexedIndirect. */
export function packDrawIndirect(vertexCount: number, instanceCount: number): Uint32Array {
  const fit = (value: number, name: string) => {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error(`${name} is not a u32`);
    return value;
  };
  return Uint32Array.of(fit(vertexCount, 'vertexCount'), fit(instanceCount, 'instanceCount'), 0, 0);
}

/** Standard Hi-Z: far is 1, reduction is max. Reversed-Z is the inverse (far 0, min) and must be declared. */
export const HIZ_BACKGROUND = 1;

/** Réduction pyramidale Hi-Z conservatrice (plafond 2x2). */
export function hizReduceCeil(depth: readonly (readonly number[])[], reversedZ = false): number[][] {
  const height = depth.length;
  const width = height > 0 ? depth[0].length : 0;
  if (width === 0 || depth.some(row => row.length !== width)) {
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
export function hizBuildPyramid(depth: readonly (readonly number[])[], reversedZ = false): number[][][] {
  const levels: number[][][] = [depth.map(row => [...row])];
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
  reversedZ = false
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
  if (!Number.isFinite(nearest) || !Number.isFinite(far) || !Number.isFinite(bias) || bias < 0) return false;
  return reversedZ ? nearest < far - bias : nearest > far + bias;
}

/** Fonction d'arête 2D (produit vectoriel 2D). */
export function edge(
  first: readonly number[],
  second: readonly number[],
  point: readonly number[]
): number {
  return (second[0] - first[0]) * (point[1] - first[1]) - (second[1] - first[1]) * (point[0] - first[0]);
}

/** Coordonnées barycentriques 2D d'un point dans un triangle. */
export function barycentric(
  vertices: readonly (readonly number[])[],
  point: readonly number[]
): [number, number, number] {
  const [first, second, third] = vertices;
  const area = edge(first, second, third);
  if (area === 0) {
    throw new Error('Triangle degenere');
  }
  return [edge(second, third, point) / area, edge(third, first, point) / area, edge(first, second, point) / area];
}
