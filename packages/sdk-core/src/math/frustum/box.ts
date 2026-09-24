/**
 * An axis-aligned box against the six planes of a frustum (see `frustum.ts`).
 *
 * For each plane, the sign of its normal chooses the most forward corner of the box, and the plane
 * rejects when that corner is behind it: `a*x + b*y + c*z + d < 0`. This is the box test of
 * the Three.js frustum, same products and same sum; a comparison with NaN never rejects.
 * The result does not depend on the order of planes, only which plane concludes.
 * Rust mirror (CPU cut walk): `frustum_clip_box` of `packages/page-codec-wasm/src/cut_error.rs`.
 */

/** The six box coordinates, arranged so that the plane sign serves as an index. */
const bounds = new Float64Array(6);

function loadBounds(
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
) {
  bounds[0] = minX;
  bounds[1] = maxX;
  bounds[2] = minY;
  bounds[3] = maxY;
  bounds[4] = minZ;
  bounds[5] = maxZ;
}

/** True when a plane already has its most forward corner behind it. */
function excludesLoaded(planes: Float64Array) {
  for (let p = 0; p < 24; p += 4) {
    const a = planes[p],
      b = planes[p + 1],
      c = planes[p + 2],
      d = planes[p + 3];
    if (a * bounds[a > 0 ? 1 : 0] + b * bounds[b > 0 ? 3 : 2] + c * bounds[c > 0 ? 5 : 4] + d < 0)
      return true;
  }
  return false;
}

/** True when the box is entirely outside the frustum: a plane leaves all its corners behind. */
export function frustumExcludesBox(
  planes: Float64Array,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
) {
  loadBounds(minX, minY, minZ, maxX, maxY, maxZ);
  return excludesLoaded(planes);
}

/**
 * The box against the frustum in three states: 0 outside, 1 straddling, 2 entirely inside. A
 * subtree entirely inside saves a test at every box underneath it.
 *
 * Two passes: the first only rejects; the second, on the most trailing corner, only serves
 * to distinguish "straddling" from "inside" and stops at the first plane crossed.
 */
export function frustumClipBox(
  planes: Float64Array,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
) {
  loadBounds(minX, minY, minZ, maxX, maxY, maxZ);
  if (excludesLoaded(planes)) return 0;
  for (let p = 0; p < 24; p += 4) {
    const a = planes[p],
      b = planes[p + 1],
      c = planes[p + 2],
      d = planes[p + 3];
    if (a * bounds[a > 0 ? 0 : 1] + b * bounds[b > 0 ? 2 : 3] + c * bounds[c > 0 ? 4 : 5] + d < 0)
      return 1;
  }
  return 2;
}
