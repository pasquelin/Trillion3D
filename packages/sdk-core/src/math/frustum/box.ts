/**
 * An axis-aligned box against the six planes of a frustum (see `frustum.ts`).
 *
 * For each plane, the sign of its normal chooses the most forward corner of the box, and the plane
 * rejects when that corner is behind it: `a*x + b*y + c*z + d < 0`. This is the box test of
 * the usual frustum test, same products and same sum; a comparison with NaN never rejects.
 * The result does not depend on the order of planes, only which plane concludes.
 * Rust mirror (CPU cut walk): `frustum_clip_box` of `packages/page-codec-wasm/src/cut_error.rs`.
 */

/*
 * The corner is chosen by value, `a > 0 ? maxX : minX`, not by an index into a scratch array: the
 * six bounds stay in registers. It picks what an index by the plane's sign would pick, NaN
 * included (`NaN > 0` is false), with the same products in the same order: the same verdict
 * (`box.test.ts`).
 */

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
  for (let p = 0; p < 24; p += 4) {
    const a = planes[p],
      b = planes[p + 1],
      c = planes[p + 2],
      d = planes[p + 3];
    if (a * (a > 0 ? maxX : minX) + b * (b > 0 ? maxY : minY) + c * (c > 0 ? maxZ : minZ) + d < 0)
      return true;
  }
  return false;
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
  if (frustumExcludesBox(planes, minX, minY, minZ, maxX, maxY, maxZ)) return 0;
  for (let p = 0; p < 24; p += 4) {
    const a = planes[p],
      b = planes[p + 1],
      c = planes[p + 2],
      d = planes[p + 3];
    if (a * (a > 0 ? minX : maxX) + b * (b > 0 ? minY : maxY) + c * (c > 0 ? minZ : maxZ) + d < 0)
      return 1;
  }
  return 2;
}
