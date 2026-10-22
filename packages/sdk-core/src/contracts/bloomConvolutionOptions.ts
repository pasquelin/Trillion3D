import { refusal } from './nameMatch.ts'
import { finiteAtLeast } from './bloomFields.ts'

/**
 * The bloom made by a convolution (`BloomOptions.method` `'convolution'`, `./bloomOptions.ts`): the
 * image is spread by a kernel, the picture of how a lens scatters a point of light, through a
 * Fourier transform — the glow of a camera, with its star and its haze, where the Gaussian sum has
 * only a bell. Cinematic: it costs a transform of the image at a fraction of its size
 * (`bloomScreenPercentage`, `./bloomRules.ts`), so it is off by default.
 *
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

/** What a page may pass to `effect.bloom({ convolution })`. */
export interface BloomConvolutionOptions {
  /** Multiplier of the convolved glow, 0 or more; 0 turns the convolution off. */
  intensity?: number
  /** The share of the kernel's energy that is spread rather than kept at the centre, times this,
   *  0 or more; 0 spreads nothing. */
  scatterDispersion?: number
  /** The kernel's width as a share of the image's, from 0 to 1 (more is read as 1). */
  size?: number
  /** The kernel; none uses the engine's own, a star with a halo. */
  kernel?: BloomKernelImage | null
  /** The luminance above which a pixel is boosted before the transform. */
  preFilterMin?: number
  /** The most a boosted pixel's luminance becomes. */
  preFilterMax?: number
  /** The slope of the boost above `preFilterMin`. */
  preFilterMult?: number
  /** The padding added around the image so the glow does not wrap, as a share of the image's
   *  width, from 0 to 1; larger costs more. */
  bufferScale?: number
}

/** The convolution as the engine reads it: every field set. */
export interface ResolvedBloomConvolution {
  readonly intensity: number
  readonly scatterDispersion: number
  readonly size: number
  readonly kernel: BloomKernelImage | undefined
  readonly preFilterMin: number
  readonly preFilterMax: number
  readonly preFilterMult: number
  readonly bufferScale: number
}

/**
 * The defaults, each the reference's own:
 * - `intensity` 1 and `scatterDispersion` 1: the whole of the kernel's scatter, at the strength the
 *   bloom's intensity gives it.
 * - `size` 1: the kernel as wide as the image.
 * - `kernel` none: the engine's own.
 * - `preFilterMin` 7, `preFilterMax` 15000, `preFilterMult` 15: a pixel over 7 in exposed
 *   luminance is boosted fifteen-fold over the excess, to 15000 at most, so that a lamp or a sun
 *   throws a halo and a lit wall does not. Sensitivity: the boost moves the halo's brightness
 *   linearly.
 * - `bufferScale` 0.133: the padding is 13.3 % of the width, 6.7 % each side, which lets a halo
 *   cross the edge without coming back in from the other.
 */
const DEFAULT_CONVOLUTION: ResolvedBloomConvolution = Object.freeze({
  intensity: 1,
  scatterDispersion: 1,
  size: 1,
  kernel: undefined,
  preFilterMin: 7,
  preFilterMax: 15000,
  preFilterMult: 15,
  bufferScale: 0.133,
})

/** `kernel` when it is a picture of `4 × width × height` values, none when it is absent.
 *  @throws TypeError when it is anything else. */
function resolveKernel(kernel: BloomKernelImage | null | undefined) {
  if (kernel === undefined || kernel === null) return undefined
  const { width, height, pixels } = kernel
  const sized = Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
  if (!sized || !(pixels instanceof Float32Array) || pixels.length !== 4 * width * height)
    return refusal('bloom')(
      'convolution.kernel must be { width, height, pixels }, pixels a Float32Array of 4 × width × height values',
    )
  return kernel
}

/**
 * The convolution an option names: every field it leaves out is the default
 * (`DEFAULT_CONVOLUTION`).
 * @throws RangeError naming the field and the value when a number is out of its range, TypeError
 *   when the kernel is not a picture.
 */
export function resolveBloomConvolution(
  options: BloomConvolutionOptions = {},
): ResolvedBloomConvolution {
  const d = DEFAULT_CONVOLUTION
  const any = -Number.MAX_VALUE
  return Object.freeze({
    intensity: finiteAtLeast(options.intensity ?? d.intensity, 0, 'BLOOM_CONVOLUTION_INTENSITY'),
    scatterDispersion: finiteAtLeast(
      options.scatterDispersion ?? d.scatterDispersion,
      0,
      'BLOOM_CONVOLUTION_SCATTER_DISPERSION',
    ),
    size: finiteAtLeast(options.size ?? d.size, 0, 'BLOOM_CONVOLUTION_SIZE'),
    kernel: resolveKernel(options.kernel),
    preFilterMin: finiteAtLeast(
      options.preFilterMin ?? d.preFilterMin,
      any,
      'BLOOM_PRE_FILTER_MIN',
    ),
    preFilterMax: finiteAtLeast(
      options.preFilterMax ?? d.preFilterMax,
      any,
      'BLOOM_PRE_FILTER_MAX',
    ),
    preFilterMult: finiteAtLeast(
      options.preFilterMult ?? d.preFilterMult,
      any,
      'BLOOM_PRE_FILTER_MULT',
    ),
    bufferScale: finiteAtLeast(options.bufferScale ?? d.bufferScale, 0, 'BLOOM_BUFFER_SCALE'),
  })
}
