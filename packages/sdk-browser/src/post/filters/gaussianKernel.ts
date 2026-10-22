/**
 * The separable Gaussian blur's kernel, written for bilinear reads: every pair of neighbouring
 * texels is one read, placed between them by their weights, so a kernel of `2r + 1` texels costs
 * `r + 1` reads. The bloom's six levels and the local exposure's blurred luminance both blur by it
 * (`gaussianStage.ts`).
 */
import { clamp, lerp } from '../../../../math/src/scalar/reals.ts'

/** Reads a pass may make: the widest kernel, 32 reads of 63 texels. A declared value: it is the
 *  uniform array a pass binds, and a wider blur costs more than it shows. */
export const GAUSSIAN_MAX_TAPS = 32
/** The radius, in texels, from which the horizontal pass writes half the width: the vertical pass
 *  reads it bilinearly. Below it the blur is narrow enough for the halved width to show. */
const FAST_BLUR_RADIUS = 7
/** The Gaussian's exponent: `exp(−16.7 (x / radius)²)` — at the radius the weight is 5e−8, so the
 *  kernel is cut where it ends, not through its bell. A declared look: it is the width at which a
 *  blur of a given size has always been drawn. */
const BELL = 16.7
/** The smallest radius a kernel is built for, in texels. */
const SMALLEST_RADIUS = 1e-5

/** The radius in texels of a blur `percent` of an image `width` texels wide across. */
export const gaussianRadius = (width: number, percent: number) => (width * percent) / 200

/** Whether a blur of `radius` texels writes its horizontal pass at half the width. */
export const gaussianHalvesWidth = (radius: number) => radius >= FAST_BLUR_RADIUS

/**
 * The weight of the texel `x` texels out when `cross` gives the centre a share, `bell` the weight
 * the Gaussian gives it: the weight itself at a `cross` of 0; from 0 to 1 the bell mixed with a
 * weight that is 1 at the centre and 0 from one texel out; above 1 that centre weight raised to
 * the power `cross`, which is 0 everywhere but the centre.
 */
function centreWeight(bell: number, x: number, cross: number) {
  if (cross === 0) return bell
  const centre = Math.max(0, 1 - Math.abs(x))
  return cross > 1 ? centre ** cross : lerp(bell, centre, cross)
}

/** The reads of one pass: the offset of each in texels from the pixel, and its weight; the
 *  weights sum to 1. */
type GaussianTaps = { offsets: Float32Array; weights: Float32Array }
/** Room for the widest kernel. */
export const gaussianTapsOf = (): GaussianTaps => ({
  offsets: new Float32Array(GAUSSIAN_MAX_TAPS),
  weights: new Float32Array(GAUSSIAN_MAX_TAPS),
})

/**
 * Fills `taps` with the kernel of a blur of `radius` texels and returns its reads. The texels
 * `−reach … +reach` are taken two by two, `reach` the radius rounded up and no wider than the
 * widest kernel; a pair is read at the weighted mean of its two offsets, with the sum of their
 * weights, and the last texel of an odd run alone. A pair of no weight at all — a radius so small
 * its outer texels vanish — stays on its first texel, where the quotient of its weights would be
 * undefined. A `cross` above 0 gives the centre texel a share of the weight (`centreWeight`): the
 * bell at 0, the bloom's cross at its own settings (`bloomCross`).
 */
export function gaussianKernel(radius: number, taps: GaussianTaps, cross = 0) {
  const sigma = clamp(radius, SMALLEST_RADIUS, GAUSSIAN_MAX_TAPS - 1)
  const reach = Math.min(Math.ceil(sigma), GAUSSIAN_MAX_TAPS - 1)
  const weight = (x: number) => centreWeight(Math.exp(-BELL * (x / sigma) ** 2), x, cross)
  let count = 0,
    sum = 0
  for (let at = -reach; at <= reach; at += 2) {
    const first = weight(at),
      second = at === reach ? 0 : weight(at + 1),
      total = first + second
    taps.offsets[count] = total > 0 ? at + second / total : at
    taps.weights[count] = total
    sum += total
    count++
  }
  for (let i = 0; i < count; i++) taps.weights[i] /= sum
  return count
}
