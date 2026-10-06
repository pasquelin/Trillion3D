/**
 * One coordinate of the smooth curve between two of its points: `b` at `w = 0`, `c` at `w = 1`,
 * leaving `b` with the slope `u = (c − a) / 2` and reaching `c` with `v = (d − b) / 2`, `a` the
 * point before `b` and `d` the one after `c`. `w2` is `w·w` and `w3` is `w2·w`, computed once by
 * the caller for its three axes.
 *
 * `P(w) = b + u·w + q·w² + k·w³` starts at `b` with slope `u`; its end at `w = 1` fixes the rest:
 *     P(1) = b + u + q + k = c,   P'(1) = u + 2q + 3k = v
 *     →  k = 2b − 2c + u + v,   q = 3c − 3b − 2u − v
 *
 * Every operation rounds once, in the order written, and that order is part of the result: each
 * end is scaled before the subtraction (`3c − 3b` rounds otherwise than `3(c − b)`), and the powers
 * are summed from the highest down, not by Horner's rule, the point `b`, usually the largest term,
 * last. `splineSpan.test.ts` pins it bit for bit.
 */
export function splineSpan(
  a: number,
  b: number,
  c: number,
  d: number,
  w: number,
  w2: number,
  w3: number,
) {
  const u = (c - a) * 0.5,
    v = (d - b) * 0.5,
    k = 2 * b - 2 * c + u + v,
    q = 3 * c - 3 * b - 2 * u - v
  return k * w3 + q * w2 + u * w + b
}
