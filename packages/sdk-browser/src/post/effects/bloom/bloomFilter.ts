/**
 * The physically based bloom, one definition for its programs: the image is
 * filtered down a chain of half-size levels, then back up, each level adding the one below it.
 * Every filter is normalised and taken with bilinear taps, so each level carries the mean
 * radiance of the image, and the chain's sum divided by its level count is the image's energy,
 * blurred; blending it in conserves energy. There is no threshold: every pixel glows in
 * proportion to its radiance.
 */

import { wgslF32 } from '../../../../../math/src/wgsl/number.ts'
import { BLOOM_LEVELS } from './bloomLevels.ts'
import { mipSize } from '../../../../../math/src/scalar/integers.ts'
import { textureBytesOf } from '../../../gpu/core/textureBytes.ts'
import { HDR_FORMAT } from '../../../scene/targetFormats.ts'

/** One bilinear tap: an offset in texels of the level read, and its weight. */
export type BloomTap = readonly [x: number, y: number, weight: number]

/**
 * The 13-tap downsample, offsets in texels of the level read: five
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
]

/** The tent upsample's row: the weights of its taps at −1, 0 and +1 texel of the level read, scaled
 *  by the bloom's `radius`; the 3×3 tent is its product with itself, which the programs read in
 *  pairs of texels (`tent`, `bloomLevel.ts`). */
export const BLOOM_UP_ROW = [1 / 4, 2 / 4, 1 / 4] as const

/** Size of each level for an image, the first half the image. */
export function bloomLevelSizes(width: number, height: number) {
  const sizes: [number, number][] = []
  // A level exists while both halvings leave a texel; its size is the mip chain's (`mipSize`).
  for (let level = 1; level <= BLOOM_LEVELS && width >>> level && height >>> level; level++)
    sizes.push([mipSize(width, level), mipSize(height, level)])
  return sizes
}

/** The texture of a bloom's levels `sizes` (`bloomLevelSizes`): one mip chain from the first. */
export const bloomLevelsTexture = (sizes: readonly (readonly [number, number])[]) => ({
  size: { width: sizes[0][0], height: sizes[0][1] },
  mipLevelCount: sizes.length,
  format: HDR_FORMAT,
})

/** Bytes of a bloom's level chain for an image, as its texture is made; none past the levels. */
export function bloomLevelBytes(width: number, height: number) {
  const sizes = bloomLevelSizes(width, height)
  return sizes.length ? (textureBytesOf(bloomLevelsTexture(sizes)) ?? 0) : 0
}

/**
 * Weights of the final blend for a bloom of `intensity` over `levels` levels: the image keeps
 * `1 − intensity`, the first level's upsampled sum gets `intensity / levels` — the mean of the
 * levels, each of which carries the image's energy.
 */
export function bloomBlend(intensity: number, levels: number) {
  return { keep: 1 - intensity, glow: levels ? intensity / levels : 0 }
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
    .map(([x, y, w]) => `c+=${sample(`${vec2}(${wgslF32(x)},${wgslF32(y)})`)}*${wgslF32(w)};`)
    .join('\n')
}
