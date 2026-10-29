import { FRUSTUM_PLANE_VALUES } from './frustum.ts'
/**
 * An axis-aligned box against the six planes of a frustum (see `frustum.ts`).
 *
 * For each plane, the sign of its normal chooses the most forward corner of the box, and the plane
 * rejects when that corner is behind it: `a*x + b*y + c*z + d < 0`. This is the box test of
 * the usual frustum test, same products and same sum; a comparison with NaN never rejects.
 * The result does not depend on the order of planes, only which plane concludes.
 */

/*
 * The corner is chosen by value, `a > 0 ? maxX : minX`, not by an index into a scratch array: the
 * six bounds stay in registers. It picks what an index by the plane's sign would pick, NaN
 * included (`NaN > 0` is false), with the same products in the same order: the same verdict
 * (`box.test.ts`).
 */

/** The distance of the box corner most forward along the plane at `planes[p..p + 3]`: negative when
 *  that corner is behind it. */
function leadingDistance(
  planes: Float64Array,
  p: number,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
) {
  const a = planes[p],
    b = planes[p + 1],
    c = planes[p + 2]
  const d = planes[p + 3]
  return a * (a > 0 ? maxX : minX) + b * (b > 0 ? maxY : minY) + c * (c > 0 ? maxZ : minZ) + d
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
  for (let p = 0; p < FRUSTUM_PLANE_VALUES; p += 4) {
    if (leadingDistance(planes, p, minX, minY, minZ, maxX, maxY, maxZ) < 0) return true
  }
  return false
}

/**
 * The box against the frustum in three states: 0 outside, 1 straddling, 2 entirely inside. A
 * subtree entirely inside saves a test at every box underneath it.
 *
 * One pass over the planes: the most forward corner rejects at the first plane that leaves it
 * behind; the most trailing corner (bounds swapped) behind a plane means the box crosses it.
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
  let straddles = false
  for (let p = 0; p < FRUSTUM_PLANE_VALUES; p += 4) {
    if (leadingDistance(planes, p, minX, minY, minZ, maxX, maxY, maxZ) < 0) return 0
    if (!straddles && leadingDistance(planes, p, maxX, maxY, maxZ, minX, minY, minZ) < 0)
      straddles = true
  }
  return straddles ? 1 : 2
}
