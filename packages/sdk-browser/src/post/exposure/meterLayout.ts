import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
import { EXPOSURE_HISTOGRAM_BUCKETS } from '../../../../sdk-core/src/contracts/exposureOptions.ts'

/**
 * The automatic exposure's meter (`meter.ts`): its uniform, and the words of its two buffers.
 *
 * The histogram of the log of a pixel's luminance is `EXPOSURE_HISTOGRAM_BUCKETS` buckets, each
 * two words: the weight in fixed point, the low word then the carry out of it (`WEIGHT_ONE` the
 * weight of one pixel), so the sum of a 4K image's rows never wraps. The exposure the pass leaves
 * is two `vec4f`: the exposure, the one the mean asks for, the mean luminance, the bias's
 * multiplier (the curve's factor in it); then the exposure over the pre-exposure the image was
 * written with, in `x`, and the local exposure's mean over the histogram, in `y` (1 where it does
 * not run).
 */

/** The weight of one pixel in a bucket, in fixed point: 2^19, so a row of up to 8192 pixels fits a
 *  32-bit word, and the words of a bucket past it carry into the next. */
export const WEIGHT_ONE = 1 << 19
/** Lanes of the measuring workgroup: one a bucket, which merge the row's counts. */
export const METER_LANES = EXPOSURE_HISTOGRAM_BUCKETS
/** Words of the histogram buffer: a bucket's weight, then its carry. */
export const HISTOGRAM_WORDS = 2 * EXPOSURE_HISTOGRAM_BUCKETS
/** Bytes of the exposure the pass leaves, which the readback copies and the composition's view
 *  takes its scale from. */
export const EXPOSURE_BYTES = 32
/** Bytes the readback brings to the CPU: the exposure, the one the mean asks, and the local
 *  exposure's mean. */
export const READBACK_BYTES = 12
/** The byte of the exposure buffer where the scale the composition multiplies the image by sits
 *  (`shown`, the exposure over the pre-exposure): the buffer's second `vec4f`. */
export const SHOWN_AT = 16
/** The byte of the exposure buffer where the local exposure's mean sits, copied to the readback
 *  after the exposure's two words. */
export const LOCAL_AT = SHOWN_AT + 4

/**
 * The meter's uniform. `size` is the pixels of the image measured, then those of its
 * half-resolution grid (each half pixel is the mean of its 2 × 2 pixels); `weights` the weights of
 * a pixel's colour channels in its luminance and, last, the lowest luminance counted; `histogram`
 * the scale and the bias taking a log2 luminance into [0, 1] over the buckets, and the weight of
 * the darkest bucket; `bounds` the lowest and the highest mean luminance the exposure follows and
 * the shares of the pixels, darkest first, under and over which the mean is not taken; `speeds`
 * the stops a second the exposure rises and falls, the distance in stops past which it moves
 * linearly, and the seconds since the last update; `response` the exponential multipliers of the
 * rise and the fall, the multiplier of the bias, and 1 where the exposure jumps to its target;
 * `image` the reciprocal of the pre-exposure the measured image holds its light multiplied by;
 * `local` the log2 of the middle grey the local exposure pulls toward (before the bias and the
 * curve), the highlights' and the shadows' contrast, and 1 where the local exposure runs (its
 * mean over the histogram is then left beside the exposure); `edges` its two thresholds and the
 * reach past each.
 */
export const METER_PARAMS = fieldLayout('MeterParams', [
  ['size', 'vec4u'],
  ['weights', 'vec4f'],
  ['histogram', 'vec4f'],
  ['bounds', 'vec4f'],
  ['speeds', 'vec4f'],
  ['response', 'vec4f'],
  ['image', 'vec4f'],
  ['local', 'vec4f'],
  ['edges', 'vec4f'],
] as const)
