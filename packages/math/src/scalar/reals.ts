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

/** The blend of `a` and `b` at `t` weighted from both ends: `a * (1 - t) + b * t`, exact at `t = 0`
 *  and `t = 1`; another rounding than `lerp`'s, so the two keep apart (`mix` of the Rust crate's
 *  `scalar.rs`). */
export const mix = (a: number, b: number, t: number) => a * (1 - t) + b * t

/** The smoothstep polynomial `t * t * (3 - 2 * t)` of `t` in `[0, 1]`: 0 and 1 at the ends, flat at
 *  both. Not clamped: `smoothstep(saturate(t))` holds a `t` out of the interval. */
export const smoothstep = (t: number) => t * t * (3 - 2 * t)

/** `value` at the nearest multiple of `step`, a half step rounding up: `Math.round(value / step) * step`. */
export const snap = (value: number, step: number) => Math.round(value / step) * step

/** `x` wrapped into `[0, n[` by a floored modulo, `n > 0`: `((x % n) + n) % n`. */
export const wrap = (x: number, n: number) => ((x % n) + n) % n

/** The fractional part of `x` toward −∞, in `[0, 1)` short of rounding: `x − Math.floor(x)`, WGSL's
 *  `fract`. A negative tiny `x` rounds to 1. */
export const fract = (x: number) => x - Math.floor(x)

/** `x` modulo `n` floored, the sign of `n`: `x − n · Math.floor(x / n)`. Unlike `wrap`
 *  it takes one division and one product, and a negative `n` folds into `(n, 0]`. */
export const floorMod = (x: number, n: number) => x - n * Math.floor(x / n)

/** The rate that leaves the share `left` of a quantity after `time` of exponential decay,
 *  `−ln(left) / time`: the inverse of `decayFactor`. */
export const decayRate = (left: number, time: number) => -Math.log(left) / time

/** The share of a quantity left after `dt` of exponential decay at `rate` per unit, `exp(−rate · dt)`. */
export const decayFactor = (rate: number, dt: number) => Math.exp(-rate * dt)

/** `out[i] = lerp(from[i], to[i], t)` over `out`'s length; `t === 1` copies `to` exactly — a lerp
 *  there can miss `to` by a rounding — so a blend run to its end lands on its target. */
export function lerpArray(
  out: Float32Array | Float64Array,
  from: ArrayLike<number>,
  to: ArrayLike<number>,
  t: number,
) {
  if (t === 1) for (let i = 0; i < out.length; i++) out[i] = to[i]
  else for (let i = 0; i < out.length; i++) out[i] = lerp(from[i], to[i], t)
  return out
}
