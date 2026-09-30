// The one-pixel model of the blend tests (#558): WebGPU's blend equation, factor by factor, and
// the witness's display value, three@0.174's ACES filmic fit then sRGB, kept independent of the
// engine's shader on purpose.
import assert from 'node:assert/strict';
import { linearToSrgb } from '../../../../sdk-core/src/math/index.ts';

export type Rgba = readonly [number, number, number, number];

/** The witness's tone curve of a linear colour: three@0.174's ACES filmic fit, clamped. */
export function filmic([r, g, b]: readonly number[]): number[] {
  const c = [r, g, b].map((v) => v / 0.6);
  const into = [0.59719, 0.076, 0.0284, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777];
  const out = [
    1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602,
  ];
  const times = (m: number[], v: number[]) =>
    [0, 1, 2].map((i) => m[i] * v[0] + m[3 + i] * v[1] + m[6 + i] * v[2]);
  const fit = times(into, c).map(
    (v) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081),
  );
  return times(out, fit).map((v) => Math.min(1, Math.max(0, v)));
}

/** The sRGB transfer of a linear colour. */
export const srgb = (rgb: readonly number[]) => rgb.map(linearToSrgb);

/** The witness's display value of a linear colour: its tone curve, then sRGB. */
export const display = (rgb: readonly number[]) => srgb(filmic(rgb));

/** `actual` within `within` of `expected`, channel by channel. */
export const close = (
  actual: readonly number[],
  expected: readonly number[],
  mode: string,
  within = 1e-6,
) =>
  actual.forEach((value, c) => assert.ok(Math.abs(value - expected[c]) < within, `${mode} ${c}`));
