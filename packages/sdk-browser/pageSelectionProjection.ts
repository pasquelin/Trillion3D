import { clusterErrorAtDepth } from '../sdk-core/index.ts';
import { clipWeight } from '../sdk-core/mathCamera.ts';
import type { ClusterCut } from './pageSelectionMath.ts';

/**
 * Distance to the view axis, `|(view(p).x, view(p).y)|`, of a point given component by component:
 * the flat cut takes it from a sphere stored in an array, the cluster-DAG oracle from three
 * already-separated numbers. One write of the multiplies, the sums and the square root.
 */
export function viewLateralOf(x: number, y: number, z: number, e: ArrayLike<number>) {
  const vx = e[0] * x + e[4] * y + e[8] * z + e[12];
  const vy = e[1] * x + e[5] * y + e[9] * z + e[13];
  return Math.sqrt(vx * vx + vy * vy);
}

/** View depth, `−view(p).z` (the camera looks toward −z), of the same point. No square root. */
export function viewDepthOf(x: number, y: number, z: number, e: ArrayLike<number>) {
  return -(e[2] * x + e[6] * y + e[10] * z + e[14]);
}

/** `viewLateralOf` of the centre of a sphere stored at `offset`. */
export function viewLateral(sphere: ArrayLike<number>, offset: number, e: ArrayLike<number>) {
  return viewLateralOf(sphere[offset], sphere[offset + 1], sphere[offset + 2], e);
}

/** `viewDepthOf` of the centre of a sphere stored at `offset`. */
export function viewDepth(sphere: ArrayLike<number>, offset: number, e: ArrayLike<number>) {
  return viewDepthOf(sphere[offset], sphere[offset + 1], sphere[offset + 2], e);
}

/** `projectedClusterError` whose axis distance and centre depth are already known. */
export function projectedErrorAt(
  error: number | null | undefined,
  lateral: number,
  depth: number,
  radius: number,
  stretch: number,
  focal: number,
  near: number,
  perspective = 1,
) {
  if (error === 0) return 0;
  if (error == null || error === Infinity) return Infinity;
  return clusterErrorAtDepth(error, stretch, lateral, depth, radius, focal, near, perspective);
}

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
  if (error === 0) return 0;
  if (error === Infinity) return Infinity;
  // Without a bounding sphere, no bound to oppose: the floor certifies nothing.
  if (!(error > 0) || !(radius >= 0)) return 0;
  const far = clipWeight(perspective, depth + radius * stretch);
  if (!(far > 0)) return Infinity;
  // The floor holds for both metrics: the external reference's EXPERIENCE variant
  // yields `ε·stretch·f/depth`, which `ε_min·stretch·f/(farthest depth of the
  // bounding sphere)` underestimates just as much as the certified bound.
  return (error * stretch * focal) / far;
}

/**
 * `cutSelects` when the threshold is zero, without projecting anything.
 *
 * Projected error is never negative, so "> 0" equals "≠ 0"; and `projectedClusterError` only
 * returns 0 for a zero error — the near plane yields infinity, a missing sphere too, and
 * `screenErrorBound` is a product of strictly positive factors as soon as the error, the stretch
 * and the focal length are. The result therefore depends on neither the camera nor the sphere: at
 * a zero threshold the cut keeps exactly the exact clusters that something replaces. The caller
 * takes this path only when the frame's stretch, focal length and near plane are finite and
 * strictly positive.
 *
 * The identity holds on the domain prepare guarantees (`pageCarriesClusterError`,
 * `clusterErrorFields`): a finite positive own error always comes with its sphere, and a parent
 * error is zero, finite positive with its sphere, or absent. A malformed error is rejected
 * on both sides. `pageSelectionProjection.test.ts` walks this domain and its edges.
 */
export function cutSelectsAtZero(rec: ClusterCut) {
  const own = rec.lodError ?? 0;
  if (own !== 0) {
    // An error that is neither zero nor positive is not cut data: the general path throws, and so does this one.
    if (!(own > 0)) throw new Error('Invalid cluster parameters');
    return false;
  }
  const parent = rec.parentError;
  if (parent != null && !(parent >= 0)) throw new Error('Invalid cluster parameters');
  return parent !== 0;
}
