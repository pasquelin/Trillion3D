/**
 * THE SLAB TEST of a ray `o + t·d` against an axis-aligned box: the one rule
 * the engine's ray–box tests share (`Ray.intersectBox`, the triangle tree's `nearestTriangleOnRay`).
 *
 * Each axis keeps the parameters where the ray lies between the box's two planes on that axis;
 * the box is hit between the largest entry and the smallest exit. A direction component of 0 keeps
 * the whole line when the origin lies between the planes — on one of them included — and nothing
 * otherwise, so a ray along a face plane never meets `0·∞ = NaN`. Every other axis cuts by the
 * quotients `(plane − o)/d`, divided rather than multiplied by `1/d`: one rounding, not two.
 */

/**
 * Cuts the span `[span[0], span[1]]` of `t` to where the ray `o + t·d` lies inside the box whose
 * lower corner is `low[lowAt..lowAt+2]` and upper corner `high[highAt..highAt+2]`; returns whether
 * the span is still non-empty. A NaN quotient cuts nothing.
 */
export function slabCut(
  span: Float64Array,
  low: ArrayLike<number>,
  lowAt: number,
  high: ArrayLike<number>,
  highAt: number,
  o: ArrayLike<number>,
  d: ArrayLike<number>,
) {
  let near = span[0],
    far = span[1]
  for (let k = 0; k < 3; k++) {
    const lower = low[lowAt + k],
      upper = high[highAt + k]
    if (d[k] === 0) {
      if (o[k] < lower || o[k] > upper) return false
      continue
    }
    let a = (lower - o[k]) / d[k],
      b = (upper - o[k]) / d[k]
    if (a > b) {
      const t = a
      a = b
      b = t
    }
    if (a > near) near = a
    if (b < far) far = b
    if (near > far) return false
  }
  span[0] = near
  span[1] = far
  return true
}
