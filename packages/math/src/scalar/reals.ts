/** Real-number helpers of ranges and blends: each the plain expression; NaN propagates unless said. */

/** `x` held to `[lo, hi]`, `hi` when `lo > hi`, -0 at a 0 bound made +0. */
export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

/** `x` held to `[lo, hi]`, `lo` when `lo > hi`: a floor that outranks its ceiling. */
export const clampLowWins = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

/**
 * The comparison-ordered clamp: `x < lo ? lo : x > hi ? hi : x`. Unlike `clamp` and
 * `clampLowWins` it keeps -0 at a 0 bound and returns `x` past a NaN bound instead of NaN; when
 * `lo > hi` it gives `lo` below `lo` and `hi` from `lo` up, where `clamp` always gives `hi` and
 * `clampLowWins` always `lo`.
 */
export const clampCompare = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x)

/** `x` held to `[0, 1]`: `clamp(x, 0, 1)`. */
export const saturate = (x: number) => clamp(x, 0, 1)

/** The line from `a` to `b` at the unclamped `t`: `a + (b - a) * t`, exact at `t = 0`. */
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** `x` wrapped into `[0, n[` by a floored modulo, `n > 0`: `((x % n) + n) % n`. */
export const wrap = (x: number, n: number) => ((x % n) + n) % n
