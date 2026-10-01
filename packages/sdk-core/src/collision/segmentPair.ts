// The closest points of two segments, the pair `closest.ts` measures a segment against each edge of
// a triangle with.

type Numbers = ArrayLike<number>;

// Stryker disable next-line EqualityOperator: at 0 and at 1 both branches return the value itself.
export const unit = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

/** The squared distance of points `a[aAt..aAt+3]` and `b[bAt..bAt+3]`. */
export function squaredGap(a: Numbers, aAt: number, b: Numbers, bAt: number) {
  const dx = a[aAt] - b[bAt],
    dy = a[aAt + 1] - b[bAt + 1],
    dz = a[aAt + 2] - b[bAt + 2];
  return dx * dx + dy * dy + dz * dz;
}

/** Where on the second segment, in `[0, 1]`, the last closest pair found lies. */
export const pairParameter = { t: 0 };

/**
 * The closest points of segments `(p, q)` and `(r, s)` — six numbers each, start then end —
 * written to `out[0..3]` (on the first) and `out[3..6]` (on the second); returns the squared
 * distance. The unconstrained optimum is clamped to the first segment, the second's parameter
 * follows, and is itself clamped with the first recomputed once: the textbook closed form.
 */
export function closestBetweenSegments(out: Float64Array, first: Numbers, second: Numbers) {
  const d1x = first[3] - first[0],
    d1y = first[4] - first[1],
    d1z = first[5] - first[2];
  const d2x = second[3] - second[0],
    d2y = second[4] - second[1],
    d2z = second[5] - second[2];
  const rx = first[0] - second[0],
    ry = first[1] - second[1],
    rz = first[2] - second[2];
  const a = d1x * d1x + d1y * d1y + d1z * d1z,
    e = d2x * d2x + d2y * d2y + d2z * d2z,
    f = d2x * rx + d2y * ry + d2z * rz,
    c = d1x * rx + d1y * ry + d1z * rz,
    b = d1x * d2x + d1y * d2y + d1z * d2z;
  let s = 0,
    t = 0;
  if (a === 0 && e === 0) s = t = 0;
  else if (a === 0) t = unit(f / e);
  else if (e === 0) s = unit(-c / a);
  else {
    const denominator = a * e - b * b;
    s = denominator > 0 ? unit((b * f - c * e) / denominator) : 0;
    t = (b * s + f) / e;
    // At exactly 0 or 1, `s` already is its recomputation.
    // Stryker disable EqualityOperator: t exactly 0 or 1
    if (t < 0) [t, s] = [0, unit(-c / a)];
    else if (t > 1) [t, s] = [1, unit((b - c) / a)];
    // Stryker restore EqualityOperator
  }
  pairParameter.t = t;
  for (let k = 0; k < 3; k++) {
    out[k] = first[k] + s * (first[3 + k] - first[k]);
    out[3 + k] = second[k] + t * (second[3 + k] - second[k]);
  }
  return squaredGap(out, 0, out, 3);
}
