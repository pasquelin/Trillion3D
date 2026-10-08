// The closest points of two segments, the pair `closest.ts` measures a segment against each edge of
// a triangle with.

import { clampCompare } from '../../../math/src/scalar/reals.ts'
import { distanceSqVector3, dotScalar3 } from '../../../math/src/vector/vector.ts'

type Numbers = ArrayLike<number>

/** A parameter held to `[0, 1]` by two comparisons: −0 and NaN go through as they come. */
const unit = (value: number) => clampCompare(value, 0, 1)

/** `(first's end − second's start)·d2`: the second's unclamped parameter against the first's end, times `|d2|²`. */
const endParameter = (first: Numbers, second: Numbers, dx: number, dy: number, dz: number) =>
  dotScalar3(first[3] - second[0], first[4] - second[1], first[5] - second[2], dx, dy, dz)

/**
 * The closest points of segments `(p, q)` and `(r, s)` — six numbers each, start then end —
 * written to `out[0..3]` (on the first) and `out[3..6]` (on the second); returns the squared
 * distance. The unconstrained optimum is clamped to the first segment, the second's parameter
 * follows, and is itself clamped with the first recomputed once: the closed form of the closest points of two segments. A
 * clamped end is written as itself, never rebuilt as `start + 1·(end − start)`, and the second's
 * parameter against the first's end is read from that end, not from `b·1 + f`.
 */
export function closestBetweenSegments(out: Float64Array, first: Numbers, second: Numbers) {
  const d1x = first[3] - first[0],
    d1y = first[4] - first[1],
    d1z = first[5] - first[2]
  const d2x = second[3] - second[0],
    d2y = second[4] - second[1],
    d2z = second[5] - second[2]
  const rx = first[0] - second[0],
    ry = first[1] - second[1],
    rz = first[2] - second[2]
  const a = dotScalar3(d1x, d1y, d1z, d1x, d1y, d1z),
    e = dotScalar3(d2x, d2y, d2z, d2x, d2y, d2z),
    f = dotScalar3(d2x, d2y, d2z, rx, ry, rz),
    c = dotScalar3(d1x, d1y, d1z, rx, ry, rz),
    b = dotScalar3(d1x, d1y, d1z, d2x, d2y, d2z)
  let s = 0,
    t = 0
  if (a === 0 && e === 0) s = t = 0
  else if (a === 0) t = unit(f / e)
  else if (e === 0) s = unit(-c / a)
  else {
    const denominator = a * e - b * b
    s = denominator > 0 ? unit((b * f - c * e) / denominator) : 0
    t = s === 1 ? endParameter(first, second, d2x, d2y, d2z) / e : (b * s + f) / e
    // At exactly 0 or 1, `s` already is its recomputation.
    // Stryker disable EqualityOperator: t exactly 0 or 1
    if (t < 0) [t, s] = [0, unit(-c / a)]
    else if (t > 1) [t, s] = [1, unit((b - c) / a)]
    // Stryker restore EqualityOperator
  }
  for (let k = 0; k < 3; k++) {
    out[k] = s === 1 ? first[3 + k] : first[k] + s * (first[3 + k] - first[k])
    out[3 + k] = t === 1 ? second[3 + k] : second[k] + t * (second[3 + k] - second[k])
  }
  return distanceSqVector3(out, out, 0, 3)
}
