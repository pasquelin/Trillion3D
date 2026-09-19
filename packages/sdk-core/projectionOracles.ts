// Mathematical oracles and reference algorithms for Web Geometry: pure TypeScript, no DOM
// and no platform dependency.
import { referenceScreenError, screenErrorVariant } from './screenErrorVariant.ts';

/** Dot product of two vectors of the same dimension. */
export function dot(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length) {
    throw new Error('Incompatible dimensions');
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
export function maxStretch(elements: ArrayLike<number>): number {
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
    throw new Error('Invalid matrix');
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
 * Certified screen error of a cluster (C4): a majorant, in pixels, of the on-screen displacement of
 * any point of a sphere moved by at most ε, under perspective projection, off-axis included.
 *
 * View frame: eye at the origin, looking toward −z, depth d = −z; pixel (f_x·x/d, f_y·y/d),
 * f = max(f_x, f_y). The primitive goes to view by an affine map of max stretch s:
 * the object sphere (c, r) sits in the view ball (C, ρ = r·s), an object displacement of at most ε
 * becomes a displacement Δ of at most δ = ε·s.
 *
 * 1. A point P = (x, y, d) of the ball goes to P' = P + Δ, of depth d' = d + Δd. With
 *    q = (x, y)/d: π(P') − π(P) = f·(Δxy − q·Δd)/d'. The map Δ ↦ Δxy − q·Δd has norm
 *    √(1 + |q|²) (eigenvalues of I + q·qᵀ: 1 and 1 + |q|²); so, whatever the direction
 *    of Δ — perpendicular to the axis, in depth toward the camera or away, oblique —,
 *    |π(P') − π(P)| ≤ f·δ·√(1 + |q|²) / d'.
 * 2. On the ball: d ≥ m = −C_z − ρ, the minimum depth; |(x, y)| ≤ ℓ + ρ, where ℓ = |(C_x, C_y)|
 *    is the centre's distance to the view axis; hence |q| ≤ (ℓ + ρ)/m, and d' ≥ m − δ.
 * 3. If m − δ > near (hence > 0): E = f·δ·√(m² + (ℓ + ρ)²) / (m·(m − δ)). Else the ball, or one
 *    of its displaced points, reaches the near plane: infinity, which refines.
 *
 * Cut monotonicity: m is the infimum of depth on the ball and ℓ + ρ the supremum of
 * distance to the axis; a ball contained in another therefore announces less, a larger error
 * more. Along the ray (C → k·C, k > 1, centre depth C_d > 0), (kℓ + ρ)/(k·C_d − ρ) and
 * 1/(k·C_d − ρ − δ) decrease: the announced error decreases with distance. The two bounds of
 * step 2 come from two different points of the ball: E is tight for a small sphere,
 * loose when the ball grazes the near plane far from the axis (`test/justesse/erreur-ecran-borne.mjs`).
 *
 * No guard here: the caller has already handled a null, infinite or invalid error. A non-finite
 * depth or distance to the axis yields infinity. Operation order, (δ·f)/m then a factor
 * √/(m − δ) ≥ 1, keeps the rounded result above sdk-browser's `errorFloorAt` floor.
 * WGSL mirror: `projected` of `gpuDagShader.ts`, same operands, same order.
 */
export function screenErrorBound(
  error: number,
  stretch: number,
  lateral: number,
  depth: number,
  radius: number,
  focal: number,
  near: number,
): number {
  // EXPERIMENT switch (`screenErrorVariant.ts`), read here for the whole CPU selection.
  if (screenErrorVariant() !== 'certifiee')
    return referenceScreenError(error, stretch, depth, focal, near);
  const reach = radius * stretch,
    shift = error * stretch;
  const nearest = depth - reach,
    closest = nearest - shift,
    side = lateral + reach;
  // The near plane first: the hypotenuse root used to be taken then discarded when it is reached.
  if (!(closest > near)) return Infinity;
  const slant = Math.sqrt(nearest * nearest + side * side);
  if (!(slant >= nearest && slant < Infinity)) return Infinity;
  return ((shift * focal) / nearest) * (slant / closest);
}

/**
 * `screenErrorBound` of a cluster whose view centre is given, parameters validated. A zero
 * error yields 0 everywhere, near plane included, and an infinite error (no replacement) infinity:
 * both stay selectable. `radius` is in object units, stretched like the error.
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
  // No guard on the centre: a NaN or ±infinity in x or y yields a `lateral` that
  // `clusterErrorAtDepth` rejects with the same message, its two short-circuits already set here.
  const lateral = Math.sqrt(centreX * centreX + centreY * centreY);
  return clusterErrorAtDepth(clusterError, stretch, lateral, -centreZ, radius, focal, near);
}

/**
 * The same projected error when the centre's distance to the view axis and its depth (−z of view)
 * are already known: a node that sets floor and ceiling on the same sphere shares its depth.
 */
export function clusterErrorAtDepth(
  clusterError: number,
  stretch: number,
  lateral: number,
  depth: number,
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
    !(lateral >= 0 && lateral < Infinity) ||
    !Number.isFinite(depth)
  ) {
    throw new Error('Invalid cluster parameters');
  }
  return screenErrorBound(clusterError, stretch, lateral, depth, radius, focal, near);
}

/** Normal-cone reject for back-face culling. */
export function coneRejects(axisDotView: number, angle: number, directionSpread = 0): boolean {
  if (
    axisDotView < -1 ||
    axisDotView > 1 ||
    angle < 0 ||
    angle > Math.PI ||
    directionSpread < 0 ||
    directionSpread > Math.PI
  ) {
    throw new Error('Invalid cone');
  }
  const totalAngle = angle + directionSpread;
  return totalAngle < Math.PI / 2 && axisDotView < -Math.sin(totalAngle);
}
