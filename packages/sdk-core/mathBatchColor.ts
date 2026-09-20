import { linearToSrgb, srgbToLinear } from './mathColor.ts';

/**
 * Converts `n` encoded sRGB colour channel values in `[0, 1]` to linear values in batch.
 *
 * Repeats `srgbToLinear`. Replaces Three.js loop: `for … color.convertSRGBToLinear()`.
 */
export function srgbToLinearBatch(out: Float64Array, values: ArrayLike<number>, n: number): void {
  for (let i = 0; i < n; i++) {
    out[i] = srgbToLinear(values[i]);
  }
}

/**
 * Converts `n` linear colour channel values to encoded sRGB values in batch.
 *
 * Repeats `linearToSrgb`. Replaces Three.js loop: `for … color.convertLinearToSRGB()`.
 */
export function linearToSrgbBatch(out: Float64Array, values: ArrayLike<number>, n: number): void {
  for (let i = 0; i < n; i++) {
    out[i] = linearToSrgb(values[i]);
  }
}
