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
  const a = elements[0],
    b = elements[4],
    c = elements[8];
  const d = elements[1],
    e = elements[5],
    f = elements[9];
  const g = elements[2],
    h = elements[6],
    i = elements[10];
  if (
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    !Number.isFinite(c) ||
    !Number.isFinite(d) ||
    !Number.isFinite(e) ||
    !Number.isFinite(f) ||
    !Number.isFinite(g) ||
    !Number.isFinite(h) ||
    !Number.isFinite(i)
  )
    throw new Error('Matrice invalide');
  const m00 = a * a + d * d + g * g,
    m11 = b * b + e * e + h * h,
    m22 = c * c + f * f + i * i;
  const m01 = a * b + d * e + g * h,
    m02 = a * c + d * f + g * i,
    m12 = b * c + e * f + h * i;
  const offDiagonal = m01 * m01 + m02 * m02 + m12 * m12;
  if (offDiagonal <= 0) return Math.sqrt(Math.max(m00, m11, m22, 0));
  const mean = (m00 + m11 + m22) / 3;
  const spread = Math.sqrt(
    ((m00 - mean) ** 2 + (m11 - mean) ** 2 + (m22 - mean) ** 2 + 2 * offDiagonal) / 6,
  );
  if (!(spread > 0)) return Math.sqrt(Math.max(mean, 0));
  const b00 = (m00 - mean) / spread,
    b11 = (m11 - mean) / spread,
    b22 = (m22 - mean) / spread;
  const b01 = m01 / spread,
    b02 = m02 / spread,
    b12 = m12 / spread;
  const determinant =
    b00 * (b11 * b22 - b12 * b12) - b01 * (b01 * b22 - b12 * b02) + b02 * (b01 * b12 - b11 * b02);
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
  near: number,
): number {
  if (clusterError === 0) return 0;
  if (clusterError === Infinity) return Infinity;
  if (
    !Number.isFinite(clusterError) ||
    clusterError < 0 ||
    !Number.isFinite(stretch) ||
    stretch < 0 ||
    !Number.isFinite(radius) ||
    radius < 0 ||
    !Number.isFinite(focal) ||
    focal <= 0 ||
    !Number.isFinite(near) ||
    near <= 0 ||
    !Number.isFinite(centreX) ||
    !Number.isFinite(centreY) ||
    !Number.isFinite(centreZ)
  ) {
    throw new Error('Parametres de cluster invalides');
  }
  const distance =
    Math.sqrt(centreX * centreX + centreY * centreY + centreZ * centreZ) - radius * stretch;
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
