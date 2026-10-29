import { isImageSize } from '../../../math/src/scalar/integers.ts'
import { refusal } from './nameMatch.ts'
import {
  ANY_NUMBER,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  resolveSettingsWith,
  rulesOf,
  type SettingOptions,
  type SettingValues,
} from './settingRules.ts'

/**
 * The bloom made by a convolution (`BloomOptions.method` `'convolution'`, `./bloomOptions.ts`): the
 * image is spread by a kernel, the picture of how a lens scatters a point of light, through a
 * Fourier transform — the glow of a camera, with its star and its haze, where the Gaussian sum has
 * only a bell. Cinematic: it costs a transform of the image at a fraction of its size
 * (`bloomScreenPercentage`, `./bloomRules.ts`), so it is off by default.
 *
 * The kernel is a picture the host gives (`kernel`): the engine draws none of its own, as it draws
 * none of the dirt mask's, and a convolution without one is refused by name (`./bloomOptions.ts`).
 * The kernel is read before it is used. Its brightest texel is its centre. The energy found in a
 * disc around the centre the width of one image pixel is the energy that stays where it is; the
 * rest, clamped to the brightest value found just outside that disc, is the scatter. The glow is
 * the image convolved with the scatter, scaled by `scatterDispersion × intensity × the bloom's
 * intensity` of the energy, and the image itself is dimmed by the same share: the convolution
 * moves light, it does not add it. The kernel is resized to `size` of the image's width, repeated
 * around its centre and padded (`bufferScale`) so the glow does not wrap from one edge to the
 * other, and its transform is kept while nothing it depends on moves (`bloomCacheKernel`).
 *
 * Before the transform, the pixels brighter than `preFilterMin` (a luminance in the image's exposed
 * radiance) are boosted: their luminance becomes `preFilterMult × (luminance − min) + min`, no more
 * than `preFilterMax`. A `preFilterMax` under the `preFilterMin` turns the boost off.
 */

/** A kernel a host gives: a picture of how a point of light spreads, square, the brightest texel
 *  its centre, in linear radiance (it is a high dynamic range picture: the centre may hold what the
 *  rest of the picture holds a million times over). */
export interface BloomKernelImage {
  /** Texels across. */
  readonly width: number
  /** Texels down. */
  readonly height: number
  /** Red, green, blue and alpha of each texel, row by row from the top, `4 × width × height`
   *  values. */
  readonly pixels: Float32Array
}

/** What a page may pass to `effect.bloom({ convolution })` besides the kernel, by field. */
const BLOOM_CONVOLUTION_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    nonNegative('intensity', 1),
    nonNegative('scatterDispersion', 1),
    nonNegative('size', 1),
    number('preFilterMin', 7, ANY_NUMBER),
    number('preFilterMax', 15000, ANY_NUMBER),
    number('preFilterMult', 15, ANY_NUMBER),
    nonNegative('bufferScale', 0.133),
  ] as const))()

/** What a page may pass to `effect.bloom({ convolution })`. Each field left out is its default,
 *  the reference's own (`BLOOM_CONVOLUTION_RULES`):
 *  - `intensity` 1 and `scatterDispersion` 1: the whole of the kernel's scatter, at the strength
 *    the bloom's intensity gives it; 0 or more, an `intensity` of 0 turns the convolution off, a
 *    `scatterDispersion` of 0 spreads nothing;
 *  - `size` 1: the kernel's width as a share of the image's, from 0 to 1 (more is read as 1);
 *  - `preFilterMin` 7, `preFilterMax` 15000, `preFilterMult` 15: a pixel over 7 in exposed
 *    luminance is boosted fifteen-fold over the excess, to 15000 at most, so that a lamp or a sun
 *    throws a halo and a lit wall does not (sensitivity: the boost moves the halo's brightness
 *    linearly); a `preFilterMax` under the `preFilterMin` turns the boost off;
 *  - `bufferScale` 0.133: the padding added around the image so the glow does not wrap, as a share
 *    of the image's width, 13.3 %, 6.7 % each side, which lets a halo cross the edge without
 *    coming back in from the other; larger costs more. */
export interface BloomConvolutionOptions extends SettingOptions<typeof BLOOM_CONVOLUTION_RULES> {
  /** The kernel the glow is made with: required when the bloom's method is `'convolution'`; `null`
   *  takes it away. */
  kernel?: BloomKernelImage | null
}

/** The convolution as the engine reads it: every field set. */
export interface ResolvedBloomConvolution extends SettingValues<typeof BLOOM_CONVOLUTION_RULES> {
  readonly kernel: BloomKernelImage | undefined
}

/** `kernel` when it is a picture of `4 × width × height` values, none when it is absent.
 *  @throws TypeError when it is anything else. */
function resolveKernel(kernel: BloomKernelImage | null | undefined) {
  if (kernel === undefined || kernel === null) return undefined
  const { width, height, pixels } = kernel
  if (
    !isImageSize(width, height) ||
    !(pixels instanceof Float32Array) ||
    pixels.length !== 4 * width * height
  )
    return refusal('bloom')(
      'convolution.kernel must be { width, height, pixels }, pixels a Float32Array of 4 × width × height values',
    )
  return kernel
}

/**
 * The convolution an option names: every field it leaves out is its default
 * (`BLOOM_CONVOLUTION_RULES`).
 * @throws TypeError naming the field and what it takes when a number is out of its range or the
 *   kernel is not a picture.
 */
export function resolveBloomConvolution(
  options: BloomConvolutionOptions = {},
): ResolvedBloomConvolution {
  return resolveSettingsWith(BLOOM_CONVOLUTION_RULES, options, 'kernel', resolveKernel)
}
