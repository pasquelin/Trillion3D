import { clipWeight } from './mathCamera.ts';
import { referenceScreenError, screenErrorVariant } from './screenErrorVariant.ts';

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
 * loose when the ball grazes the near plane far from the axis (`tests/browser/probes/erreur-ecran-borne.ts`).
 *
 * ONE CAMERA, ONE FORMULA. `perspective` is the camera's clip-w weight: a point at view depth d
 * has w = perspective·d + (1 − perspective) — 1 for a perspective projection (w = d, all of the
 * above), 0 for an orthographic one (w = 1: q = 0, and a displacement moves the pixel by f·δ
 * whatever the depth). The bound is written on w: E = f·δ·√(w_m² + (p·(ℓ + ρ))²) / (w_m·w_{m−δ}),
 * with the near plane reached when w_{m−δ} ≤ p·near. At p = 1 every operation is the one above,
 * bit for bit (a product by 1 and a sum with 0 are exact).
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
  perspective = 1,
): number {
  // EXPERIMENT switch (`screenErrorVariant.ts`), read here for the whole CPU selection.
  if (screenErrorVariant() !== 'certifiee')
    return referenceScreenError(error, stretch, depth, focal, near, perspective);
  const reach = radius * stretch,
    shift = error * stretch;
  const nearest = clipWeight(perspective, depth - reach),
    closest = nearest - perspective * shift,
    side = perspective * (lateral + reach);
  // The near plane first: the hypotenuse root used to be taken then discarded when it is reached.
  if (!(closest > perspective * near)) return Infinity;
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
  perspective = 1,
): number {
  if (clusterError === 0) return 0;
  if (clusterError === Infinity) return Infinity;
  // No guard on the centre: a NaN or ±infinity in x or y yields a `lateral` that
  // `clusterErrorAtDepth` rejects with the same message, its two short-circuits already set here.
  const lateral = Math.sqrt(centreX * centreX + centreY * centreY);
  return clusterErrorAtDepth(
    clusterError,
    stretch,
    lateral,
    -centreZ,
    radius,
    focal,
    near,
    perspective,
  );
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
  perspective = 1,
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
    !Number.isFinite(depth) ||
    !(perspective >= 0 && perspective <= 1)
  ) {
    throw new Error('Invalid cluster parameters');
  }
  return screenErrorBound(clusterError, stretch, lateral, depth, radius, focal, near, perspective);
}
