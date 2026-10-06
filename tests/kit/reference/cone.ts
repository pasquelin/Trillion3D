// The normal cone the WebGPU prepare built from the host vertices until #272, kept as the reference
// the compiler's cooked cone and the run-time cut's are checked against
// (`packages/page-codec-wasm/src/normal_cone.rs`, `tests/integration/cooked-cones.test.ts`,
// `packages/sdk-browser/src/world/page/cutCones.test.ts`) and the input the cone tests and probes
// build from. No engine source calls it: the engine reads the cone `normal_cone.rs` built.
import { OPEN_CONE, type NormalCone } from '../../../packages/sdk-browser/src/page/cone/cone.ts';

/** Ulps a built angle may stand above this reference's: twice `ANGLE_MARGIN_ULPS` (4,
 *  `normal_cone.rs`). */
const WIDEST = 2n * 4n;
/** The float64 word of `value`: ulps apart for two numbers of one sign. */
const word = (value: number) => new BigUint64Array(Float64Array.of(value).buffer)[0];

/** Whether `cone`, built by `normal_cone.rs`, bounds the triangles of `indices` over `positions`:
 *  every non-degenerate face's normal within its angle (by this runtime's `Math.acos`), and that
 *  angle at most `WIDEST` ulps above `triangleCone`'s on the same triangles. The compiler keeps the
 *  narrower of the mean cone and the smallest one (#929), so the axis may differ from this one. */
export function coneHolds(
  cone: NormalCone,
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
): boolean {
  const reference = triangleCone(positions, indices);
  if (word(cone.angle) > word(reference.angle) + WIDEST) return false;
  return widestAngle(positions, indices, cone.axis) <= cone.angle;
}

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

/** Each non-degenerate face's cross product and its length, in index order. */
function* faces(positions: ArrayLike<number>, indices: ArrayLike<number>) {
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const c = faceCross(positions, indices[i] * 3, indices[i + 1] * 3, indices[i + 2] * 3);
    const len = Math.hypot(c[0], c[1], c[2]);
    if (len > 0) yield { c, len };
  }
}

/** The widest angle, by this runtime's `Math.acos`, between `axis` and a face's normal. */
function widestAngle(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  axis: readonly [number, number, number],
): number {
  let angle = 0;
  for (const { c, len } of faces(positions, indices)) {
    const d = Math.min(1, Math.max(-1, (c[0] * axis[0] + c[1] * axis[1] + c[2] * axis[2]) / len));
    const a = Math.acos(d);
    if (a > angle) angle = a;
  }
  return angle;
}

/** Bounding cone of triangle normals. Degenerate faces skipped; none valid → OPEN_CONE. */
export function triangleCone(positions: ArrayLike<number>, indices: ArrayLike<number>): NormalCone {
  let sx = 0,
    sy = 0,
    sz = 0,
    count = 0;
  for (const { c } of faces(positions, indices)) {
    sx += c[0];
    sy += c[1];
    sz += c[2];
    count++;
  }
  if (!count) return OPEN_CONE;
  const sl = Math.hypot(sx, sy, sz);
  if (!(sl > 0)) return OPEN_CONE;
  const axis: [number, number, number] = [sx / sl, sy / sl, sz / sl];
  return { axis, angle: widestAngle(positions, indices, axis) };
}
