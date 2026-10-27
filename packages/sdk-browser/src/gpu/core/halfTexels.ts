import { HALF_MAX } from '../../../../math/src/constants.ts'
import { toHalf } from '../../../../math/src/float/half.ts'

/** Half float bits of 1: a texel's alpha. */
const HALF_ONE = toHalf(1)

/**
 * `texels` RGB texels of `rgb` from the number `from`, each channel times `scale` and held to what a half float holds, written into
 * `out` as the four half floats of an `rgba16float` texel with an alpha of 1: the one conversion of the cubemaps the lighting and
 * the fog read. Returns `out`.
 */
export function rgbToHalfRgba(
  out: Uint16Array<ArrayBuffer>,
  rgb: ArrayLike<number>,
  from: number,
  texels: number,
  scale = 1,
) {
  for (let i = 0; i < texels; i++) {
    for (let c = 0; c < 3; c++)
      out[i * 4 + c] = toHalf(Math.min(rgb[from + i * 3 + c] * scale, HALF_MAX))
    out[i * 4 + 3] = HALF_ONE
  }
  return out
}
