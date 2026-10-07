import { clipWeight } from '../../../../sdk-core/src/math/primitives/camera.ts'

/**
 * Floor of a subtree's projected error: the smallest error it carries, seen at the farthest
 * depth its bounding sphere allows. Never above the true value of any of its clusters, so it
 * can decide a whole subtree without descending it.
 *
 * Bound proof: a sphere (c_i, r_i) contained in (C, R) satisfies |c_i − C| + r_i ≤ R;
 * after a transform that stretches by at most `stretch`, the view ball (C_i, ρ_i) fits in
 * (C, R·stretch), so its minimum depth m_i satisfies m_i ≤ −C_z + R·stretch. The
 * `screenErrorBound` error is (δ_i·f/m_i)·(√(m_i² + (ℓ_i + ρ_i)²)/(m_i − δ_i)), whose second factor
 * is ≥ 1: it exceeds δ_i·f/m_i ≥ ε_min·stretch·f / (−C_z + R·stretch). If that denominator is
 * zero or negative, every sphere in the subtree is on the eye plane or behind it, and their
 * projected error is infinite.
 *
 * `depth` is `−view(C).z`, already computed by the caller: a node's floor and ceiling share it.
 * Under an orthographic projection (`perspective` 0) the clip weight is 1 at every depth, and
 * the floor is ε_min·stretch·f itself — the error every cluster of the subtree announces at least.
 */
export function errorFloorAt(
  error: number,
  depth: number,
  radius: number,
  stretch: number,
  focal: number,
  perspective = 1,
) {
  if (error === 0) return 0
  if (error === Infinity) return Infinity
  // Without a bounding sphere, no bound to oppose: the floor certifies nothing.
  if (!(error > 0) || !(radius >= 0)) return 0
  const far = clipWeight(perspective, depth + radius * stretch)
  if (!(far > 0)) return Infinity
  // The floor holds for both metrics: the plain projection (`screenError: 'reference'`)
  // yields `ε·stretch·f/depth`, which `ε_min·stretch·f/(farthest depth of the
  // bounding sphere)` underestimates just as much as the certified bound.
  return (error * stretch * focal) / far
}
