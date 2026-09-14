import { clusterErrorPixels } from '../sdk-core/index.ts';
import * as THREE from 'three';

export type ClusterCut = {
  lodError?: number;
  sphere?: number[];
  parentError?: number | null;
  parentSphere?: number[] | null;
  group?: number | null;
  source?: number | null;
};
/** Projected screen error of one (error, object-space sphere) pair, in the frame given by `e`. */
export function projectedClusterError(
  error: number | null | undefined,
  sphere: ArrayLike<number> | null | undefined,
  offset: number,
  e: ArrayLike<number>,
  stretch: number,
  focal: number,
  near: number,
) {
  // Exact geometry and clusters with no replacement need no projection at all, which is most of them.
  if (error === 0) return 0;
  if (error == null || error === Infinity) return Infinity;
  if (!sphere) return Infinity;
  const cx = sphere[offset],
    cy = sphere[offset + 1],
    cz = sphere[offset + 2];
  const vx = e[0] * cx + e[4] * cy + e[8] * cz + e[12];
  const vy = e[1] * cx + e[5] * cy + e[9] * cz + e[13];
  const vz = e[2] * cx + e[6] * cy + e[10] * cz + e[14];
  return clusterErrorPixels(error, stretch, vx, vy, vz, sphere[offset + 3], focal, near);
}
export function cutSelects(
  rec: ClusterCut,
  e: ArrayLike<number>,
  stretch: number,
  focal: number,
  near: number,
  pixelError: number,
) {
  if (projectedClusterError(rec.lodError ?? 0, rec.sphere, 0, e, stretch, focal, near) > pixelError)
    return false;
  return (
    projectedClusterError(
      rec.parentError,
      rec.parentSphere ?? rec.sphere,
      0,
      e,
      stretch,
      focal,
      near,
    ) > pixelError
  );
}
/** Six frustum planes of `clip`, inward-facing, unnormalised: a point is inside when every ax+by+cz+d >= 0.
 *  Taken in the space `clip` maps from, so the caller never transforms a box. Allocation free. */
export function extractPlanes(clip: THREE.Matrix4, planes: Float64Array) {
  const m = clip.elements;
  const x0 = m[0],
    x1 = m[4],
    x2 = m[8],
    x3 = m[12];
  const y0 = m[1],
    y1 = m[5],
    y2 = m[9],
    y3 = m[13];
  const z0 = m[2],
    z1 = m[6],
    z2 = m[10],
    z3 = m[14];
  const w0 = m[3],
    w1 = m[7],
    w2 = m[11],
    w3 = m[15];
  planes[0] = w0 + x0;
  planes[1] = w1 + x1;
  planes[2] = w2 + x2;
  planes[3] = w3 + x3;
  planes[4] = w0 - x0;
  planes[5] = w1 - x1;
  planes[6] = w2 - x2;
  planes[7] = w3 - x3;
  planes[8] = w0 + y0;
  planes[9] = w1 + y1;
  planes[10] = w2 + y2;
  planes[11] = w3 + y3;
  planes[12] = w0 - y0;
  planes[13] = w1 - y1;
  planes[14] = w2 - y2;
  planes[15] = w3 - y3;
  planes[16] = w0 + z0;
  planes[17] = w1 + z1;
  planes[18] = w2 + z2;
  planes[19] = w3 + z3;
  planes[20] = w0 - z0;
  planes[21] = w1 - z1;
  planes[22] = w2 - z2;
  planes[23] = w3 - z3;
}
/** Axis-aligned box against the six planes: 0 outside, 1 straddling, 2 fully inside.
 *  A subtree that is fully inside spares every box below it a test. */
export function boxClip(
  planes: Float64Array,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
) {
  let inside = 2;
  for (let p = 0; p < 24; p += 4) {
    const a = planes[p],
      b = planes[p + 1],
      c = planes[p + 2],
      d = planes[p + 3];
    if (a * (a > 0 ? maxX : minX) + b * (b > 0 ? maxY : minY) + c * (c > 0 ? maxZ : minZ) + d < 0)
      return 0;
    if (
      inside === 2 &&
      a * (a > 0 ? minX : maxX) + b * (b > 0 ? minY : maxY) + c * (c > 0 ? minZ : maxZ) + d < 0
    )
      inside = 1;
  }
  return inside;
}
