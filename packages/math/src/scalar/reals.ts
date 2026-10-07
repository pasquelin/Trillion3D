/** Real-number helpers of ranges and blends: each the plain expression; NaN propagates unless said. */

/** `x` held to `[lo, hi]`, `hi` when `lo > hi`, -0 at a 0 bound made +0. */
export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

/** `x` held to `[lo, hi]`, `lo` when `lo > hi`: a floor that outranks its ceiling. */
export const clampLowWins = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

/**
 * The comparison-ordered clamp: `value < min ? min : value > max ? max : value`, the public
 * `math.clamp` (its parameter names are that API's). Unlike `clamp` and `clampLowWins` it keeps -0
 * at a 0 bound and returns `value` past a NaN bound instead of NaN; when `min > max` it gives `min`
 * below `min` and `max` from `min` up, where `clamp` always gives the upper bound and
 * `clampLowWins` always the lower.
 */
export const clampCompare = (value: number, min: number, max: number) =>
  value < min ? min : value > max ? max : value

/** `x` held to `[0, 1]`: `clamp(x, 0, 1)`. */
export const saturate = (x: number) => clamp(x, 0, 1)

/** The line from `a` to `b` at the unclamped `t`: `a + (b - a) * t`, exact at `t = 0`. */
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** `x` wrapped into `[0, n[` by a floored modulo, `n > 0`: `((x % n) + n) % n`. */
export const wrap = (x: number, n: number) => ((x % n) + n) % n
