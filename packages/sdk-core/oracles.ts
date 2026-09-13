/**
 * Oracles mathématiques et algorithmes de référence pour Web Geometry.
 * Référence pure TypeScript (sans DOM ni dépendances plateforme).
 */

function isClose(a: number, b: number, relTol = 1e-9, absTol = 1e-12): boolean {
  return Math.abs(a - b) <= Math.max(relTol * Math.max(Math.abs(a), Math.abs(b)), absTol);
}

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

/** Norme euclidienne L2 d'un vecteur. */
export function norm(vector: readonly number[]): number {
  return Math.sqrt(dot(vector, vector));
}

/** Matrice quadrique 4x4 construite à partir d'un ensemble de plans pondérés [a, b, c, d]. */
export function quadricFromPlanes(planes: readonly (readonly [readonly number[], number])[]): number[][] {
  const result: number[][] = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  for (const [plane, weight] of planes) {
    if (
      plane.length !== 4 ||
      !Number.isFinite(weight) ||
      weight < 0 ||
      plane.some(v => !Number.isFinite(v)) ||
      !isClose(norm(plane.slice(0, 3)), 1.0)
    ) {
      throw new Error('Plan ou poids invalide');
    }
    const p0 = plane[0], p1 = plane[1], p2 = plane[2], p3 = plane[3];
    const w0 = weight * p0, w1 = weight * p1, w2 = weight * p2, w3 = weight * p3;
    const r0 = result[0], r1 = result[1], r2 = result[2], r3 = result[3];
    r0[0] += w0 * p0; r0[1] += w0 * p1; r0[2] += w0 * p2; r0[3] += w0 * p3;
    r1[0] += w1 * p0; r1[1] += w1 * p1; r1[2] += w1 * p2; r1[3] += w1 * p3;
    r2[0] += w2 * p0; r2[1] += w2 * p1; r2[2] += w2 * p2; r2[3] += w2 * p3;
    r3[0] += w3 * p0; r3[1] += w3 * p1; r3[2] += w3 * p2; r3[3] += w3 * p3;
  }
  return result;
}

/** Énergie quadrique Q(p) = p^T * Q * p en coordonnées homogènes. */
export function quadricEnergy(quadric: readonly (readonly number[])[], position: readonly number[]): number {
  const x = position[0], y = position[1], z = position[2];
  const q0 = quadric[0], q1 = quadric[1], q2 = quadric[2], q3 = quadric[3];
  const v0 = x * q0[0] + y * q0[1] + z * q0[2] + q0[3];
  const v1 = x * q1[0] + y * q1[1] + z * q1[2] + q1[3];
  const v2 = x * q2[0] + y * q2[1] + z * q2[2] + q2[3];
  const v3 = x * q3[0] + y * q3[1] + z * q3[2] + q3[3];
  return x * v0 + y * v1 + z * v2 + v3;
}

/** Résolution d'un système linéaire par élimination de Gauss avec pivot partiel. */
export function solvePivoted(
  matrix: readonly (readonly number[])[],
  target: readonly number[],
  relativeTolerance = 1e-12
): number[] | null {
  const size = target.length;
  if (size === 3 && matrix.length === 3 && matrix[0]?.length === 3 && matrix[1]?.length === 3 && matrix[2]?.length === 3) {
    let a00 = matrix[0][0], a01 = matrix[0][1], a02 = matrix[0][2], b0 = target[0];
    let a10 = matrix[1][0], a11 = matrix[1][1], a12 = matrix[1][2], b1 = target[1];
    let a20 = matrix[2][0], a21 = matrix[2][1], a22 = matrix[2][2], b2 = target[2];

    const scale = Math.max(
      Math.abs(a00), Math.abs(a01), Math.abs(a02),
      Math.abs(a10), Math.abs(a11), Math.abs(a12),
      Math.abs(a20), Math.abs(a21), Math.abs(a22)
    );
    if (scale === 0) return null;
    const tol = scale * relativeTolerance;

    let p0 = 0, max0 = Math.abs(a00);
    let v1 = Math.abs(a10); if (v1 > max0) { max0 = v1; p0 = 1; }
    let v2 = Math.abs(a20); if (v2 > max0) { max0 = v2; p0 = 2; }
    if (max0 <= tol) return null;
    if (p0 === 1) {
      let t = a00; a00 = a10; a10 = t;
      t = a01; a01 = a11; a11 = t;
      t = a02; a02 = a12; a12 = t;
      t = b0; b0 = b1; b1 = t;
    } else if (p0 === 2) {
      let t = a00; a00 = a20; a20 = t;
      t = a01; a01 = a21; a21 = t;
      t = a02; a02 = a22; a22 = t;
      t = b0; b0 = b2; b2 = t;
    }
    const div0 = a00;
    a01 /= div0; a02 /= div0; b0 /= div0;
    a11 -= a10 * a01; a12 -= a10 * a02; b1 -= a10 * b0;
    a21 -= a20 * a01; a22 -= a20 * a02; b2 -= a20 * b0;

    let p1 = 1, max1 = Math.abs(a11);
    v2 = Math.abs(a21); if (v2 > max1) { max1 = v2; p1 = 2; }
    if (max1 <= tol) return null;
    if (p1 === 2) {
      let t = a11; a11 = a21; a21 = t;
      t = a12; a12 = a22; a22 = t;
      t = b1; b1 = b2; b2 = t;
    }
    const div1 = a11;
    a12 /= div1; b1 /= div1;
    b0 -= a01 * b1;
    a02 -= a01 * a12;
    a22 -= a21 * a12; b2 -= a21 * b1;

    if (Math.abs(a22) <= tol) return null;
    b2 /= a22;
    b0 -= a02 * b2;
    b1 -= a12 * b2;

    return [b0, b1, b2];
  }

  const augmented: number[][] = matrix.map((row, i) => [...row, target[i]]);
  let scale = 0;
  for (const row of matrix) {
    for (const val of row) {
      scale = Math.max(scale, Math.abs(val));
    }
  }
  if (scale === 0) return null;

  for (let col = 0; col < size; col++) {
    let pivot = col;
    let maxVal = Math.abs(augmented[col][col]);
    for (let row = col + 1; row < size; row++) {
      const val = Math.abs(augmented[row][col]);
      if (val > maxVal) {
        maxVal = val;
        pivot = row;
      }
    }
    if (maxVal <= scale * relativeTolerance) {
      return null;
    }
    const temp = augmented[col];
    augmented[col] = augmented[pivot];
    augmented[pivot] = temp;

    const divisor = augmented[col][col];
    for (let j = col; j <= size; j++) {
      augmented[col][j] /= divisor;
    }
    for (let row = 0; row < size; row++) {
      if (row !== col) {
        const factor = augmented[row][col];
        for (let j = col; j <= size; j++) {
          augmented[row][j] -= factor * augmented[col][j];
        }
      }
    }
  }
  return augmented.map(row => row[size]);
}

/** Choix du meilleur candidat pour la contraction d'arête selon l'énergie quadrique. */
export function quadricCandidate(
  quadric: readonly (readonly number[])[],
  left: readonly number[],
  right: readonly number[]
): number[] {
  const q0 = quadric[0], q1 = quadric[1], q2 = quadric[2];
  const matrix = [
    [q0[0], q0[1], q0[2]],
    [q1[0], q1[1], q1[2]],
    [q2[0], q2[1], q2[2]],
  ];
  const target = [-q0[3], -q1[3], -q2[3]];
  const optimum = solvePivoted(matrix, target);
  const mid = [(left[0] + right[0]) * 0.5, (left[1] + right[1]) * 0.5, (left[2] + right[2]) * 0.5];
  let best = [left[0], left[1], left[2]];
  let bestEnergy = quadricEnergy(quadric, best);

  const eRight = quadricEnergy(quadric, right);
  if (eRight < bestEnergy) {
    bestEnergy = eRight;
    best = [right[0], right[1], right[2]];
  }

  const eMid = quadricEnergy(quadric, mid);
  if (eMid < bestEnergy) {
    bestEnergy = eMid;
    best = mid;
  }

  if (optimum !== null) {
    const eOpt = quadricEnergy(quadric, optimum);
    if (eOpt < bestEnergy) {
      best = optimum;
    }
  }
  return best;
}

/** Projection centrale d'un point 3D sur le plan image. */
export function projectedPoint(point: readonly number[], focal: readonly number[]): [number, number] {
  if (point[2] <= 0) {
    throw new Error('Point hors domaine perspective');
  }
  return [(focal[0] * point[0]) / point[2], (focal[1] * point[1]) / point[2]];
}

/** Majoration garantie de l'erreur projetée en pixels issue de la norme de la Jacobienne. */
export function projectedErrorBound(
  error: number,
  minimum: readonly number[],
  maximum: readonly number[],
  focal: readonly number[],
  near = 0.01
): number {
  if (minimum.length !== 3 || maximum.length !== 3 || focal.length !== 2) {
    throw new Error('Dimensions de projection invalides');
  }
  const min0 = minimum[0], min1 = minimum[1], min2 = minimum[2];
  const max0 = maximum[0], max1 = maximum[1], max2 = maximum[2];
  const f0 = focal[0], f1 = focal[1];
  if (
    error < 0 ||
    !Number.isFinite(error) ||
    !Number.isFinite(near) ||
    !Number.isFinite(min0) || !Number.isFinite(min1) || !Number.isFinite(min2) ||
    !Number.isFinite(max0) || !Number.isFinite(max1) || !Number.isFinite(max2) ||
    !Number.isFinite(f0) || !Number.isFinite(f1)
  ) {
    throw new Error('Valeur invalide');
  }
  if (min0 > max0 || min1 > max1 || min2 > max2 || near <= 0) {
    throw new Error('Boite ou plan proche invalide');
  }
  if (min2 <= near) {
    return Infinity;
  }
  const t0 = Math.max(Math.abs(min0), Math.abs(max0));
  const t1 = Math.max(Math.abs(min1), Math.abs(max1));
  const transverseSquared = t0 * t0 + t1 * t1;
  const maxFocal = Math.max(Math.abs(f0), Math.abs(f1));
  return ((error * maxFocal) / min2) * Math.sqrt(1 + transverseSquared / (min2 * min2));
}

/** Screen-pixel LOD score from the stored conservative object-space distance bound. */
export function lodScore(
  errorObject: number,
  errorScale: number,
  minimum: readonly number[],
  maximum: readonly number[],
  pixelScale: readonly number[],
  projection: 'perspective' | 'orthographic',
  near: number
): number {
  if (
    !Number.isFinite(errorObject) || errorObject < 0 ||
    !Number.isFinite(errorScale) || errorScale < 0 ||
    !Number.isFinite(near) || near < 0 ||
    pixelScale.length !== 2 ||
    !Number.isFinite(pixelScale[0]) || pixelScale[0] <= 0 ||
    !Number.isFinite(pixelScale[1]) || pixelScale[1] <= 0
  ) {
    throw new Error('Parametres LOD invalides');
  }
  const errorView = errorObject * errorScale;
  if (!Number.isFinite(errorView)) {
    throw new Error('Erreur transformee hors domaine');
  }
  if (projection === 'orthographic') {
    return errorView * Math.max(pixelScale[0], pixelScale[1]);
  }
  if (projection === 'perspective') {
    return projectedErrorBound(errorView, minimum, maximum, pixelScale, near);
  }
  throw new Error('Projection inconnue');
}

/** Nombre de bits nécessaires pour coder une plage entière [low, high]. */
export function requiredBits(low: number | bigint, high: number | bigint): number {
  if (typeof low === 'number' && typeof high === 'number' && Number.isSafeInteger(low) && Number.isSafeInteger(high)) {
    if (high < low) throw new Error('Plage entiere invalide');
    const diff = high - low;
    if (diff === 0) return 0;
    if (diff <= 0x7fffffff) return 32 - Math.clz32(diff);
    if (diff <= 0xffffffff) return 32;
  }
  const bLow = BigInt(low);
  const bHigh = BigInt(high);
  if (bHigh < bLow) {
    throw new Error('Plage entiere invalide');
  }
  const diff = bHigh - bLow;
  if (diff === 0n) return 0;
  return diff.toString(2).length;
}

/** Calcul du lien simplicial (étoile frontière) d'un simplexe dans un maillage triangulé. */
export function simplicialLink(
  triangles: readonly (readonly [number, number, number])[],
  simplex: ReadonlySet<number>
): Set<string> {
  const result = new Set<string>();
  const sSize = simplex.size;
  if (sSize === 1) {
    let target = 0;
    for (const s of simplex) target = s;
    for (let i = 0; i < triangles.length; i++) {
      const tri = triangles[i];
      const t0 = tri[0], t1 = tri[1], t2 = tri[2];
      let r0: number, r1: number;
      if (t0 === target) { r0 = t1; r1 = t2; }
      else if (t1 === target) { r0 = t0; r1 = t2; }
      else if (t2 === target) { r0 = t0; r1 = t1; }
      else continue;
      if (r0 === r1) {
        result.add(String(r0));
      } else {
        if (r0 > r1) { const tmp = r0; r0 = r1; r1 = tmp; }
        result.add(String(r0));
        result.add(String(r1));
        result.add(`${r0},${r1}`);
      }
    }
    return result;
  }
  if (sSize === 2) {
    let u = 0, v = 0;
    let idx = 0;
    for (const s of simplex) { if (idx === 0) u = s; else v = s; idx++; }
    for (let i = 0; i < triangles.length; i++) {
      const tri = triangles[i];
      const t0 = tri[0], t1 = tri[1], t2 = tri[2];
      if ((t0 === u && t1 === v) || (t0 === v && t1 === u)) result.add(String(t2));
      else if ((t0 === u && t2 === v) || (t0 === v && t2 === u)) result.add(String(t1));
      else if ((t1 === u && t2 === v) || (t1 === v && t2 === u)) result.add(String(t0));
    }
    return result;
  }
  for (const triangle of triangles) {
    const triSet = new Set(triangle);
    let containsSimplex = true;
    for (const v of simplex) {
      if (!triSet.has(v)) {
        containsSimplex = false;
        break;
      }
    }
    if (containsSimplex) {
      const remaining: number[] = [];
      for (const v of triSet) {
        if (!simplex.has(v)) remaining.push(v);
      }
      remaining.sort((a, b) => a - b);
      if (remaining.length === 1) {
        result.add(String(remaining[0]));
      } else if (remaining.length === 2) {
        result.add(String(remaining[0]));
        result.add(String(remaining[1]));
        result.add(`${remaining[0]},${remaining[1]}`);
      }
    }
  }
  return result;
}

/** Condition de lien (Link Condition) pour garantir la préservation de la topologie 2-manifold lors d'une contraction d'arête. */
export function linkCondition(
  triangles: readonly (readonly [number, number, number])[],
  left: number,
  right: number
): boolean {
  const linkLeft = simplicialLink(triangles, new Set([left]));
  const linkRight = simplicialLink(triangles, new Set([right]));
  const linkEdge = simplicialLink(triangles, new Set([left, right]));

  const intersection = new Set<string>();
  for (const item of linkLeft) {
    if (linkRight.has(item)) {
      intersection.add(item);
    }
  }
  if (intersection.size !== linkEdge.size) return false;
  for (const item of linkEdge) {
    if (!linkLeft.has(item) || !linkRight.has(item)) return false;
  }
  return true;
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

/** Distance euclidienne minimale exacte entre un point 3D et un triangle 3D. */
export function pointTriangleDistance(
  point: readonly number[],
  triangle: readonly (readonly number[])[]
): number {
  const p0 = triangle[0], p1 = triangle[1], p2 = triangle[2];
  const px = point[0], py = point[1], pz = point[2];

  let minSq = Infinity;

  // Segment 0: p0 -> p1
  const d0x = p1[0] - p0[0], d0y = p1[1] - p0[1], d0z = p1[2] - p0[2];
  const o0x = px - p0[0], o0y = py - p0[1], o0z = pz - p0[2];
  const sq0 = d0x * d0x + d0y * d0y + d0z * d0z;
  const r0 = sq0 ? Math.max(0, Math.min(1, (o0x * d0x + o0y * d0y + o0z * d0z) / sq0)) : 0;
  const cx0 = p0[0] + r0 * d0x, cy0 = p0[1] + r0 * d0y, cz0 = p0[2] + r0 * d0z;
  const distSq0 = (px - cx0) ** 2 + (py - cy0) ** 2 + (pz - cz0) ** 2;
  if (distSq0 < minSq) minSq = distSq0;

  // Segment 1: p1 -> p2
  const d1x = p2[0] - p1[0], d1y = p2[1] - p1[1], d1z = p2[2] - p1[2];
  const o1x = px - p1[0], o1y = py - p1[1], o1z = pz - p1[2];
  const sq1 = d1x * d1x + d1y * d1y + d1z * d1z;
  const r1 = sq1 ? Math.max(0, Math.min(1, (o1x * d1x + o1y * d1y + o1z * d1z) / sq1)) : 0;
  const cx1 = p1[0] + r1 * d1x, cy1 = p1[1] + r1 * d1y, cz1 = p1[2] + r1 * d1z;
  const distSq1 = (px - cx1) ** 2 + (py - cy1) ** 2 + (pz - cz1) ** 2;
  if (distSq1 < minSq) minSq = distSq1;

  // Segment 2: p2 -> p0
  const d2x = p0[0] - p2[0], d2y = p0[1] - p2[1], d2z = p0[2] - p2[2];
  const o2x = px - p2[0], o2y = py - p2[1], o2z = pz - p2[2];
  const sq2 = d2x * d2x + d2y * d2y + d2z * d2z;
  const r2 = sq2 ? Math.max(0, Math.min(1, (o2x * d2x + o2y * d2y + o2z * d2z) / sq2)) : 0;
  const cx2 = p2[0] + r2 * d2x, cy2 = p2[1] + r2 * d2y, cz2 = p2[2] + r2 * d2z;
  const distSq2 = (px - cx2) ** 2 + (py - cy2) ** 2 + (pz - cz2) ** 2;
  if (distSq2 < minSq) minSq = distSq2;

  // Interior face check
  const aa = sq0;
  const ebx = p2[0] - p0[0], eby = p2[1] - p0[1], ebz = p2[2] - p0[2];
  const ab = d0x * ebx + d0y * eby + d0z * ebz;
  const bb = ebx * ebx + eby * eby + ebz * ebz;
  const det = aa * bb - ab * ab;
  if (det > 0) {
    const dotOffA = o0x * d0x + o0y * d0y + o0z * d0z;
    const dotOffB = o0x * ebx + o0y * eby + o0z * ebz;
    const u = (bb * dotOffA - ab * dotOffB) / det;
    const v = (aa * dotOffB - ab * dotOffA) / det;
    if (u >= 0 && v >= 0 && u + v <= 1) {
      const cx = p0[0] + u * d0x + v * ebx;
      const cy = p0[1] + u * d0y + v * eby;
      const cz = p0[2] + u * d0z + v * ebz;
      const dSq = (px - cx) ** 2 + (py - cy) ** 2 + (pz - cz) ** 2;
      if (dSq < minSq) minSq = dSq;
    }
  }

  return Math.sqrt(minSq);
}

/** Union minimale englobante de deux sphères 3D. */
export function sphereUnion(
  firstCenter: readonly number[],
  firstRadius: number,
  secondCenter: readonly number[],
  secondRadius: number
): [number[], number] {
  if (firstRadius < 0 || secondRadius < 0) {
    throw new Error('Rayon negatif');
  }
  const direction = [secondCenter[0] - firstCenter[0], secondCenter[1] - firstCenter[1], secondCenter[2] - firstCenter[2]];
  const distance = norm(direction);
  if (firstRadius >= distance + secondRadius) {
    return [[...firstCenter], firstRadius];
  }
  if (secondRadius >= distance + firstRadius) {
    return [[...secondCenter], secondRadius];
  }
  const radius = (distance + firstRadius + secondRadius) / 2;
  const center = firstCenter.map((val, i) => val + ((radius - firstRadius) * direction[i]) / distance);
  return [center, radius];
}

/** Test de séparation conservateur entre une boîte AABB et un plan. */
export function aabbOutsidePlane(
  center: readonly number[],
  extent: readonly number[],
  normal: readonly number[],
  offset: number
): boolean {
  if (extent.some(v => v < 0)) {
    throw new Error('Etendue negative');
  }
  return dot(normal, center) + offset + dot(normal.map(Math.abs), extent) < 0;
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

/** Interpolation perspective d'attributs avec coordonnées homogènes clip_w. */
export function perspectiveAttribute(
  weights: readonly number[],
  clipW: readonly number[],
  attributes: readonly number[]
): number {
  let denom = 0;
  for (let i = 0; i < weights.length; i++) {
    denom += weights[i] / clipW[i];
  }
  if (denom === 0) {
    throw new Error('Denominateur nul');
  }
  let num = 0;
  for (let i = 0; i < weights.length; i++) {
    num += (weights[i] * attributes[i]) / clipW[i];
  }
  return num / denom;
}

/** Dérivée analytique d'un attribut projeté dans l'espace écran. */
export function perspectiveDerivative(
  weights: readonly number[],
  derivativeWeights: readonly number[],
  clipW: readonly number[],
  attributes: readonly number[]
): number {
  let denom = 0;
  let num = 0;
  let dDenom = 0;
  let dNum = 0;
  for (let i = 0; i < weights.length; i++) {
    denom += weights[i] / clipW[i];
    num += (weights[i] * attributes[i]) / clipW[i];
    dDenom += derivativeWeights[i] / clipW[i];
    dNum += (derivativeWeights[i] * attributes[i]) / clipW[i];
  }
  if (denom === 0) {
    throw new Error('Denominateur nul');
  }
  return (dNum * denom - num * dDenom) / (denom * denom);
}

/** Quantification entière avec pas régulier et reconstruction. */
export function quantize(value: number, step: number, origin = 0.0): [number, number] {
  if (step <= 0) {
    throw new Error('Pas invalide');
  }
  const scaled = (value - origin) / step;
  const integer = Math.floor(scaled + 0.5);
  return [integer, origin + step * integer];
}

/** Signe non nul (1 pour >= 0, -1 pour < 0). */
export function signNotZero(value: number): number {
  return value < 0 ? -1 : 1;
}

/** Encodage octaédrique d'un vecteur normal unitaire vers 2D [-1, 1]. */
export function octEncode(normal: readonly number[]): [number, number] {
  const total = Math.abs(normal[0]) + Math.abs(normal[1]) + Math.abs(normal[2]);
  if (total === 0) {
    throw new Error('Normale nulle');
  }
  let h = normal[0] / total;
  let v = normal[1] / total;
  const d = normal[2] / total;
  if (d < 0) {
    const origH = h;
    const origV = v;
    h = (1 - Math.abs(origV)) * signNotZero(origH);
    v = (1 - Math.abs(origH)) * signNotZero(origV);
  }
  return [h, v];
}

/** Décodage octaédrique de 2D [-1, 1] vers normale 3D unitaire. */
export function octDecode(encoded: readonly [number, number]): [number, number, number] {
  let h = encoded[0];
  let v = encoded[1];
  const d = 1 - Math.abs(h) - Math.abs(v);
  if (d < 0) {
    const origH = h;
    const origV = v;
    h = (1 - Math.abs(origV)) * signNotZero(origH);
    v = (1 - Math.abs(origH)) * signNotZero(origV);
  }
  const len = Math.hypot(h, v, d);
  return [h / len, v / len, d / len];
}

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let bit = 0; bit < 8; bit++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c >>> 0;
}

/** Calcul de somme de contrôle CRC32 standard (polynôme 0xEDB88320). */
export function crc(data: Uint8Array | readonly number[]): number {
  let value = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    value = (value >>> 8) ^ CRC_TABLE[(value ^ data[i]) & 0xff];
  }
  return (value ^ 0xffffffff) >>> 0;
}

/** Compactage de poids flottants sous un budget entier exact avec arrondi de Hare-Niemeyer. */
export function packedWeights(weights: readonly number[], maximum: number): number[] {
  if (!Number.isInteger(maximum) || maximum <= 0) {
    throw new Error('Budget entier invalide');
  }
  if (!weights.length || weights.some(v => !Number.isFinite(v) || v < 0)) {
    throw new Error('Poids invalides');
  }
  const total = weights.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error('Somme invalide');
  }
  const raw = weights.map(w => (w / total) * maximum);
  const result = raw.map(Math.floor);
  const remainder = maximum - result.reduce((a, b) => a + b, 0);
  if (remainder < 0 || remainder > result.length) {
    throw new Error('Arrondi hors domaine');
  }
  const order = Array.from({ length: result.length }, (_, i) => i).sort((a, b) => {
    const diff = -(raw[a] - result[a]) - -(raw[b] - result[b]);
    return diff !== 0 ? diff : a - b;
  });
  for (let i = 0; i < remainder; i++) {
    result[order[i]]++;
  }
  return result;
}

/** Vérification des limites de plage de sections dans un fichier binaire. */
export function validRange(offset: number | bigint, size: number | bigint, total: number | bigint): boolean {
  const bOffset = BigInt(offset);
  const bSize = BigInt(size);
  const bTotal = BigInt(total);
  return bOffset >= 0n && bSize >= 0n && bTotal >= 0n && bOffset <= bTotal && bSize <= bTotal - bOffset;
}

/** Transformation zigzag / fold pour coder les entiers relatifs en naturels positifs. */
export function signedFold(value: number): number {
  return value >= 0 ? 2 * value : -2 * value - 1;
}

/** Décodage inverse zigzag / unfold. */
export function signedUnfold(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('Entier non signe requis');
  }
  return value % 2 === 0 ? Math.floor(value / 2) : -Math.floor(value / 2) - 1;
}

/** Bornes de projection perspective tangentes d'une sphère 3D devant le plan proche. */
export function sphereRatioBounds(
  center: readonly number[],
  radius: number,
  near: number
): [[number, number], [number, number]] {
  if (
    center.length !== 3 ||
    [...center, radius, near].some(v => !Number.isFinite(v)) ||
    radius < 0 ||
    near <= 0 ||
    center[2] - radius <= near
  ) {
    throw new Error('Sphere hors domaine non clippe');
  }
  const z = center[2];
  const denominator = z * z - radius * radius;
  if (!Number.isFinite(denominator) || denominator <= 0) {
    throw new Error('Sphere hors plage arithmetique de cet oracle');
  }
  const result: [number, number][] = [];
  for (let axis = 0; axis < 2; axis++) {
    const coord = center[axis];
    const spread = radius * Math.sqrt(coord * coord + denominator);
    result.push([(coord * z - spread) / denominator, (coord * z + spread) / denominator]);
  }
  if (result.some(pair => pair.some(v => !Number.isFinite(v)))) {
    throw new Error('Sphere hors plage arithmetique de cet oracle');
  }
  return [result[0], result[1]];
}

/** Encodage de profondeur non linéaire dans la plage [0, 1]. */
export function depthEncode(distance: number, near: number, far: number | null = null, reversedZ = false): number {
  if (
    !Number.isFinite(near) ||
    near <= 0 ||
    !Number.isFinite(distance) ||
    distance < near ||
    (far !== null && (!Number.isFinite(far) || far <= near || distance > far))
  ) {
    throw new Error('Domaine de profondeur invalide');
  }
  if (reversedZ) {
    return far === null ? near / distance : (near / distance) * ((far - distance) / (far - near));
  }
  return far === null ? 1 - near / distance : ((distance - near) / distance) * (far / (far - near));
}

/** Décodage inverse d'une valeur de profondeur tampon vers la distance caméra réelle. */
export function depthDecode(value: number, near: number, far: number | null = null, reversedZ = false): number {
  if (
    !Number.isFinite(near) ||
    near <= 0 ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1 ||
    (far !== null && (!Number.isFinite(far) || far <= near))
  ) {
    throw new Error('Domaine de profondeur invalide');
  }
  let denominator: number;
  if (far === null) {
    denominator = reversedZ ? value : 1 - value;
  } else {
    const ratio = near / far;
    denominator = reversedZ ? ratio + (1 - ratio) * value : 1 - value + ratio * value;
  }
  return denominator === 0 ? Infinity : near / denominator;
}

/** Partition uniforme équitable d'un nombre d'éléments entre travailleurs parallèles. */
export function dispatchRange(
  count: number | bigint,
  workers: number,
  index: number
): [number | bigint, number | bigint] {
  const bCount = BigInt(count);
  const bWorkers = BigInt(workers);
  const bIndex = BigInt(index);
  if (
    bCount < 0n ||
    bWorkers <= 0n ||
    bIndex < 0n ||
    bIndex >= bWorkers
  ) {
    throw new Error('Plage de travail invalide');
  }
  const start = (bIndex * bCount) / bWorkers;
  const end = ((bIndex + 1n) * bCount) / bWorkers;
  return typeof count === 'bigint' ? [start, end] : [Number(start), Number(end)];
}

/** Bornes extrêmes [min, max] d'une fonction affine sur un rectangle centré. */
export function affineRectangleRange(
  coefficients: readonly number[],
  center: readonly number[],
  halfSize: readonly number[]
): [number, number] {
  if (
    coefficients.length !== 3 ||
    center.length !== 2 ||
    halfSize.length !== 2 ||
    [...coefficients, ...center, ...halfSize].some(v => !Number.isFinite(v)) ||
    Math.min(...halfSize) < 0
  ) {
    throw new Error('Rectangle invalide');
  }
  const [a, b, c] = coefficients;
  const middle = a * center[0] + b * center[1] + c;
  const radius = Math.abs(a) * halfSize[0] + Math.abs(b) * halfSize[1];
  return [middle - radius, middle + radius];
}

/** Composition séquentielle de deux masques de bits (ET / OU). */
export function composeBitPatches(
  first: readonly [number, number],
  second: readonly [number, number]
): [number, number] {
  const [a1, o1] = first;
  const [a2, o2] = second;
  if (![a1, o1, a2, o2].every(v => Number.isInteger(v) && v >= 0)) {
    throw new Error('Masque entier non negatif requis');
  }
  return [a1 & a2, ((o1 & a2) | o2) >>> 0];
}

/** Distance euclidienne au carré entre deux points donnés en coordonnées barycentriques sur un triangle 3D. */
export function barycentricDistanceSquared(
  vertices: readonly (readonly number[])[],
  first: readonly number[],
  second: readonly number[]
): number {
  if (
    vertices.length !== 3 ||
    first.length !== 3 ||
    second.length !== 3
  ) {
    throw new Error('Coordonnees barycentriques invalides');
  }
  const v0 = vertices[0], v1 = vertices[1], v2 = vertices[2];
  if (!v0 || !v1 || !v2 || v0.length !== 3 || v1.length !== 3 || v2.length !== 3) {
    throw new Error('Coordonnees barycentriques invalides');
  }
  const f0 = first[0], f1 = first[1], f2 = first[2];
  const s0 = second[0], s1 = second[1], s2 = second[2];
  const sum1 = f0 + f1 + f2;
  const sum2 = s0 + s1 + s2;
  if (!Number.isFinite(sum1) || !Number.isFinite(sum2) ||
      !isClose(sum1, 1) || !isClose(sum2, 1)) {
    throw new Error('Coordonnees barycentriques invalides');
  }
  for (let i = 0; i < 3; i++) {
    if (!Number.isFinite(v0[i]) || !Number.isFinite(v1[i]) || !Number.isFinite(v2[i]) ||
        !Number.isFinite(first[i]) || !Number.isFinite(second[i])) {
      throw new Error('Coordonnees barycentriques invalides');
    }
  }
  const d0 = f0 / sum1 - s0 / sum2;
  const d1 = f1 / sum1 - s1 / sum2;
  const d2 = f2 / sum1 - s2 / sum2;

  const e01 = (v0[0] - v1[0]) ** 2 + (v0[1] - v1[1]) ** 2 + (v0[2] - v1[2]) ** 2;
  const e02 = (v0[0] - v2[0]) ** 2 + (v0[1] - v2[1]) ** 2 + (v0[2] - v2[2]) ** 2;
  const e12 = (v1[0] - v2[0]) ** 2 + (v1[1] - v2[1]) ** 2 + (v1[2] - v2[2]) ** 2;

  const result = -(d0 * d1 * e01 + d0 * d2 * e02 + d1 * d2 * e12);
  return result === 0 ? 0 : result;
}

/** Évaluation d'une courbe de Bézier cubique 3D au paramètre t in [0, 1]. */
export function bezierCubic(points: readonly (readonly number[])[], t: number): [number, number, number] {
  if (
    points.length !== 4 ||
    !Number.isFinite(t) ||
    t < 0 ||
    t > 1
  ) {
    throw new Error('Courbe invalide');
  }
  const p0 = points[0], p1 = points[1], p2 = points[2], p3 = points[3];
  if (!p0 || !p1 || !p2 || !p3 || p0.length !== 3 || p1.length !== 3 || p2.length !== 3 || p3.length !== 3) {
    throw new Error('Courbe invalide');
  }
  const x0 = p0[0], y0 = p0[1], z0 = p0[2];
  const x1 = p1[0], y1 = p1[1], z1 = p1[2];
  const x2 = p2[0], y2 = p2[1], z2 = p2[2];
  const x3 = p3[0], y3 = p3[1], z3 = p3[2];
  if (
    !Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(z0) ||
    !Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(z1) ||
    !Number.isFinite(x2) || !Number.isFinite(y2) || !Number.isFinite(z2) ||
    !Number.isFinite(x3) || !Number.isFinite(y3) || !Number.isFinite(z3)
  ) {
    throw new Error('Courbe invalide');
  }
  const u = 1 - t;
  const u2 = u * u;
  const u3 = u2 * u;
  const t2 = t * t;
  const t3 = t2 * t;
  const w0 = u3;
  const w1 = 3 * u2 * t;
  const w2 = 3 * u * t2;
  const w3 = t3;
  return [
    w0 * x0 + w1 * x1 + w2 * x2 + w3 * x3,
    w0 * y0 + w1 * y1 + w2 * y2 + w3 * y3,
    w0 * z0 + w1 * z1 + w2 * z2 + w3 * z3,
  ];
}

/** Évaluation de la distribution micro-facette SGGX diagonale. */
export function sggxDiagonal(
  diagonal: readonly number[],
  normal: readonly number[],
  view: readonly number[]
): [number, number, number] {
  if (
    diagonal.length !== 3 ||
    normal.length !== 3 ||
    view.length !== 3 ||
    [...diagonal, ...normal, ...view].some(v => !Number.isFinite(v)) ||
    Math.min(...diagonal) <= 0 ||
    !isClose(norm(normal), 1) ||
    !isClose(norm(view), 1)
  ) {
    throw new Error('SGGX exige une matrice positive et des directions unitaires');
  }
  const sigma = Math.sqrt(diagonal[0] * view[0] ** 2 + diagonal[1] * view[1] ** 2 + diagonal[2] * view[2] ** 2);
  const denom = normal[0] ** 2 / diagonal[0] + normal[1] ** 2 / diagonal[1] + normal[2] ** 2 / diagonal[2];
  const prod = diagonal[0] * diagonal[1] * diagonal[2];
  const distribution = 1 / (Math.PI * Math.sqrt(prod) * denom ** 2);
  const pdf = (Math.max(0, dot(view, normal)) * distribution) / sigma;

  if (!Number.isFinite(sigma) || !Number.isFinite(distribution) || !Number.isFinite(pdf)) {
    throw new Error('SGGX hors plage arithmetique de cet oracle');
  }
  return [sigma, distribution, pdf];
}

/** Transmittance exponentielle de Beer-Lambert T = exp(-sigma * length). */
export function transmittance(extinction: number, length: number): number {
  if (!Number.isFinite(extinction) || !Number.isFinite(length) || extinction < 0 || length < 0) {
    throw new Error('Extinction et longueur finies non negatives requises');
  }
  return Math.exp(-extinction * length);
}
