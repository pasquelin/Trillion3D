/**
 * The physically based bloom of Jimenez, "Next Generation Post Processing in Call of Duty:
 * Advanced Warfare" (SIGGRAPH 2014), one definition for the WGSL and GLSL programs: the image is
 * filtered down a chain of half-size levels, then back up, each level adding the one below it.
 * Every filter is normalised and taken with bilinear taps, so each level carries the mean
 * radiance of the image, and the chain's sum divided by its level count is the image's energy,
 * blurred; blending it in conserves energy. There is no threshold: every pixel glows in
 * proportion to its radiance.
 */

import { shaderFloat } from '../lighting/shaderConstants.ts';

/** One bilinear tap: an offset in texels of the level read, and its weight. */
export type BloomTap = readonly [x: number, y: number, weight: number];

/**
 * The 13-tap downsample (Jimenez 2014), offsets in texels of the level read: five
 * overlapping 2×2 boxes, the centre one weighted 0.5 and the four corner ones 0.125 each, which
 * removes the flicker a single box shows on moving highlights.
 */
export const BLOOM_DOWN_TAPS: readonly BloomTap[] = [
  [-2, 2, 0.03125],
  [0, 2, 0.0625],
  [2, 2, 0.03125],
  [-2, 0, 0.0625],
  [0, 0, 0.125],
  [2, 0, 0.0625],
  [-2, -2, 0.03125],
  [0, -2, 0.0625],
  [2, -2, 0.03125],
  [-1, 1, 0.125],
  [1, 1, 0.125],
  [-1, -1, 0.125],
  [1, -1, 0.125],
];

/** The 3×3 tent upsample (Jimenez 2014), offsets in texels of the level read, scaled
 *  by the bloom's `radius`. */
export const BLOOM_UP_TAPS: readonly BloomTap[] = [
  [-1, 1, 1 / 16],
  [0, 1, 2 / 16],
  [1, 1, 1 / 16],
  [-1, 0, 2 / 16],
  [0, 0, 4 / 16],
  [1, 0, 2 / 16],
  [-1, -1, 1 / 16],
  [0, -1, 2 / 16],
  [1, -1, 1 / 16],
];

/**
 * Levels of the chain: the six of the publication, fewer on an image too small to halve six
 * times — a level is at least one texel. A declared value, not a measured one: it sets how far
 * the widest glow reaches, 2⁶ texels of the image per texel of the last level.
 */
export const BLOOM_LEVELS = 6;

/** Bytes per texel of every bloom target: `rgba16float`. */
export const BLOOM_TEXEL_BYTES = 8;

/** Size of each level for an image, the first half the image. */
export function bloomLevelSizes(width: number, height: number) {
  const sizes: [number, number][] = [];
  for (let level = 1; level <= BLOOM_LEVELS; level++) {
    const w = Math.floor(width / 2 ** level),
      h = Math.floor(height / 2 ** level);
    if (w < 1 || h < 1) break;
    sizes.push([w, h]);
  }
  return sizes;
}

/** Bytes of a bloom's level chain for an image. */
export function bloomLevelBytes(width: number, height: number) {
  let texels = 0;
  for (const [w, h] of bloomLevelSizes(width, height)) texels += w * h;
  return texels * BLOOM_TEXEL_BYTES;
}

/**
 * Weights of the final blend for a bloom of `intensity` over `levels` levels: the image keeps
 * `1 − intensity`, the first level's upsampled sum gets `intensity / levels` — the mean of the
 * levels, each of which carries the image's energy.
 */
export function bloomBlend(intensity: number, levels: number) {
  return { keep: 1 - intensity, glow: levels ? intensity / levels : 0 };
}

/**
 * The taps as shader text: `sample(offset)` is the language's bilinear read at `uv` plus that
 * offset times `step`, and each read is weighted and summed into `c`.
 */
export function bloomTapText(
  taps: readonly BloomTap[],
  sample: (offset: string) => string,
  vec2: string,
) {
  return taps
    .map(
      ([x, y, w]) =>
        `c+=${sample(`${vec2}(${shaderFloat(x)},${shaderFloat(y)})`)}*${shaderFloat(w)};`,
    )
    .join('\n');
}
