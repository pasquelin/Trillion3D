/** Real-number helpers of ranges and blends: the plain expressions, written once. */

/**
 * `x` held to `[lo, hi]`: `Math.min(hi, Math.max(lo, x))`.
 *
 * - NaN `x`, `lo` or `hi` gives NaN.
 * - When `lo > hi` the result is `hi` (the upper bound wins). A site that needs the lower bound to
 *   win in that case (`Math.max(lo, Math.min(hi, x))`) keeps its own expression.
 * - A -0 `x` gives +0 when a bound is 0: `Math.max(0, -0)` is +0.
 * - Infinities clamp to the bounds.
 */
export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

/** `x` held to `[0, 1]`: `clamp(x, 0, 1)`, so NaN stays NaN and -0 becomes +0. */
export const saturate = (x: number) => clamp(x, 0, 1)

/**
 * The line from `a` to `b` at `t`: `a + (b - a) * t`. Exact at `t = 0`, not always at `t = 1`
 * (the last bit may differ from `b`); `t` is not clamped.
 */
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/**
 * `x` wrapped into `[0, n[` by a floored (Euclidean) modulo, `n > 0`: `((x % n) + n) % n`. Unlike
 * `%`, a negative `x` gives a non-negative result, and -0 gives +0. NaN gives NaN. For `x` a
 * hair under 0 the sum rounds to `n` and the result is 0, so `n` itself is never returned.
 */
export const wrap = (x: number, n: number) => ((x % n) + n) % n
