import { OPEN_CONE, type NormalCone } from './pageCone.ts';

function faceCross(positions: ArrayLike<number>, ia: number, ib: number, ic: number) {
  const ax = positions[ia],
    ay = positions[ia + 1],
    az = positions[ia + 2];
  const e1x = positions[ib] - ax,
    e1y = positions[ib + 1] - ay,
    e1z = positions[ib + 2] - az;
  const e2x = positions[ic] - ax,
    e2y = positions[ic + 1] - ay,
    e2z = positions[ic + 2] - az;
  return [e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x] as const;
}

/** Bounding cone of triangle normals. Degenerate faces skipped; none valid → OPEN_CONE. */
export function triangleCone(positions: ArrayLike<number>, indices: ArrayLike<number>): NormalCone {
  let sx = 0,
    sy = 0,
    sz = 0,
    count = 0;
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const c = faceCross(positions, indices[i] * 3, indices[i + 1] * 3, indices[i + 2] * 3);
    const len = Math.hypot(c[0], c[1], c[2]);
    if (!(len > 0)) continue;
    sx += c[0];
    sy += c[1];
    sz += c[2];
    count++;
  }
  if (!count) return OPEN_CONE;
  const sl = Math.hypot(sx, sy, sz);
  if (!(sl > 0)) return OPEN_CONE;
  const axis: [number, number, number] = [sx / sl, sy / sl, sz / sl];
  let angle = 0;
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const c = faceCross(positions, indices[i] * 3, indices[i + 1] * 3, indices[i + 2] * 3);
    const len = Math.hypot(c[0], c[1], c[2]);
    if (!(len > 0)) continue;
    const d = Math.min(1, Math.max(-1, (c[0] * axis[0] + c[1] * axis[1] + c[2] * axis[2]) / len));
    const a = Math.acos(d);
    if (a > angle) angle = a;
  }
  return { axis, angle };
}
