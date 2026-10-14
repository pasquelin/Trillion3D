/**
 * A RAY `o + t·d` AGAINST A SPHERE OR A RECTANGLE, closed form, `d` of any length: the one cast of
 * each the analytic references share (a sphere's, an ellipsoid's in its scaled frame, a pane's).
 */

/**
 * Writes into `span` the two parameters `t`, nearer first, where the ray `o + t·d` crosses the
 * sphere of centre `c` and radius `r`; returns whether it does. With `oc = o − c`, `b = oc·d` and
 * `a = d·d`, the roots of `a t² + 2b t + (oc·oc − r²)` are `(−b ∓ √(b² − a(oc·oc − r²)))/a`: half the
 * textbook quadratic's terms, the same roots to the bit. A zero direction or a negative
 * discriminant misses.
 */
export function raySphere(
  span: Float64Array,
  o: ArrayLike<number>,
  d: ArrayLike<number>,
  c: ArrayLike<number>,
  r: number,
) {
  const x = o[0] - c[0],
    y = o[1] - c[1],
    z = o[2] - c[2]
  const a = d[0] * d[0] + d[1] * d[1] + d[2] * d[2],
    b = x * d[0] + y * d[1] + z * d[2],
    disc = b * b - a * (x * x + y * y + z * z - r * r)
  if (a === 0 || disc < 0) return false
  const root = Math.sqrt(disc)
  span[0] = (-b - root) / a
  span[1] = (-b + root) / a
  return true
}

/**
 * The parameter `t` (of either sign) where the ray `o + t·d` crosses the rectangle of centre `at`,
 * unit normal `n` and unit axes `u`, `v` in its plane, `halfU` and `halfV` its half-sides along
 * them; NaN where it misses it or runs along its plane (`|d·n| ≤ 1e-12`).
 */
export function rayRectangle(
  o: ArrayLike<number>,
  d: ArrayLike<number>,
  at: ArrayLike<number>,
  n: ArrayLike<number>,
  u: ArrayLike<number>,
  v: ArrayLike<number>,
  halfU: number,
  halfV: number,
) {
  const along = d[0] * n[0] + d[1] * n[1] + d[2] * n[2]
  if (!(Math.abs(along) > 1e-12)) return NaN
  const t = ((at[0] - o[0]) * n[0] + (at[1] - o[1]) * n[1] + (at[2] - o[2]) * n[2]) / along
  const x = o[0] + d[0] * t - at[0],
    y = o[1] + d[1] * t - at[1],
    z = o[2] + d[2] * t - at[2]
  const s = x * u[0] + y * u[1] + z * u[2],
    w = x * v[0] + y * v[1] + z * v[2]
  return Math.abs(s) <= halfU && Math.abs(w) <= halfV ? t : NaN
}
