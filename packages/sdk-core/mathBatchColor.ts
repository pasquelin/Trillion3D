import { linearToSrgb, srgbToLinear } from './mathColor.ts';

/**
 * Converts `n` encoded sRGB channel values in `[0, 1]` to linear: `out[i] = srgbToLinear(values[i])`,
 * one number per element on both sides.
 *
 * Repeats `srgbToLinear`. Replaces Three.js loop: `for … color.convertSRGBToLinear()`.
 * DECLARED DIFFERENCE with the reference, inherited from the unit function: the engine writes
 * the exact curve where the reference multiplies by rounded constants — at most `1.1e-11` apart
 * per channel, invisible at 8 bits (`three-vs-core-batch-colors.perf.mjs`).
 */
export function srgbToLinearBatch(out: Float64Array, values: ArrayLike<number>, n: number): void {
  for (let i = 0; i < n; i++) {
    out[i] = srgbToLinear(values[i]);
  }
}

/**
 * Converts `n` linear channel values to encoded sRGB: `out[i] = linearToSrgb(values[i])`.
 *
 * Repeats `linearToSrgb`. Replaces Three.js loop: `for … color.convertLinearToSRGB()`.
 * Same declared difference as above, wider on this side of the curve: at most `6.3e-6` per channel
 * (the bound of the mean value theorem on the rounded exponent, `6.21e-6` measured).
 */
export function linearToSrgbBatch(out: Float64Array, values: ArrayLike<number>, n: number): void {
  for (let i = 0; i < n; i++) {
    out[i] = linearToSrgb(values[i]);
  }
}
