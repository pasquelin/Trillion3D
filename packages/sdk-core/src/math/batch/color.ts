import { linearToSrgb, srgbToLinear } from '../primitives/color.ts';

/**
 * Converts `n` encoded sRGB channel values in `[0, 1]` to linear: `out[i] = srgbToLinear(values[i])`,
 * one number per element on both sides.
 *
 * Repeats `srgbToLinear`.
 * DECLARED DIFFERENCE with the rounded-constant formula, inherited from the unit function: the engine writes
 * the exact curve where that formula multiplies by rounded constants. The gap per channel is
 * bounded by `SRGB_REFERENCE_GAP` (`bench/oracles/core/`), invisible at 8 bits.
 */
export function srgbToLinearBatch(out: Float64Array, values: ArrayLike<number>, n: number): void {
  for (let i = 0; i < n; i++) {
    out[i] = srgbToLinear(values[i]);
  }
}

/**
 * Converts `n` linear channel values to encoded sRGB: `out[i] = linearToSrgb(values[i])`.
 *
 * Repeats `linearToSrgb`.
 * Same declared difference as above, wider on this side of the curve: bounded by
 * `LINEAR_SRGB_REFERENCE_GAP`, derived in the same file.
 */
export function linearToSrgbBatch(out: Float64Array, values: ArrayLike<number>, n: number): void {
  for (let i = 0; i < n; i++) {
    out[i] = linearToSrgb(values[i]);
  }
}
