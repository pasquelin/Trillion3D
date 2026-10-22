/**
 * The separable Gaussian blur's kernel, written for bilinear reads: every pair of neighbouring
 * texels is one read, placed between them by their weights, so a kernel of `2r + 1` texels costs
 * `r + 1` reads. The bloom's six levels and the local exposure's blurred luminance both blur by it
 * (`gaussianStage.ts`).
 */
import { clamp, lerp } from '../../../../math/src/scalar/reals.ts'

/** Reads a pass may make at most: the uniform array a pass binds. A declared value: 128 reads of 255
 *  texels, the widest kernel any loop mode (`gaussianTapCap`) allows. */
export const GAUSSIAN_MAX_TAPS = 128
/** The reads of a pass under the loop mode 0, the default: 32, a kernel of 63 texels at most. */
const UNROLLED_TAPS = 32
/** The Gaussian's exponent: `exp(−16.7 (x / radius)²)` — at the radius the weight is 5e−8, so the
 *  kernel is cut where it ends, not through its bell. A declared look: it is the width at which a
 *  blur of a given size has always been drawn. */
const BELL = 16.7
/** The smallest radius a kernel is built for, in texels. */
const SMALLEST_RADIUS = 1e-5

/** The radius in texels of a blur `percent` of an image `width` texels wide across. */
export const gaussianRadius = (width: number, percent: number) => (width * percent) / 200

/** Whether a blur of `radius` texels writes its horizontal pass at half the width, from the radius
 *  `threshold` on (`gaussianFastBlurThreshold`): the vertical pass reads that bilinearly, a cheaper
 *  pass of a blur a little softer along x, which shows more the narrower the blur. */
export const gaussianHalvesWidth = (radius: number, threshold: number) => radius >= threshold

/** The most reads a pass makes under the loop mode `mode` (`gaussianLoopMode`): 32 under 0, 128 under
 *  1 and 2. The mode also says how the reference runs the reads — unrolled, or by a loop with a stop
 *  test —, which here is one loop whose count the uniform holds: 1 and 2 are the same. */
export const gaussianTapCap = (mode: number) => (mode === 0 ? UNROLLED_TAPS : GAUSSIAN_MAX_TAPS)

/** The scale of a blur's reach as the setting is read: `gaussianSampleScale`, from 0.1 to 10. */
const SMALLEST_SCALE = 0.1
const LARGEST_SCALE = 10

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
 * `−reach … +reach` are taken two by two, `reach` the radius times `scale` (`gaussianSampleScale`,
 * held from 0.1 to 10) rounded up and no wider than the widest kernel `cap` reads allow
 * (`gaussianTapCap`); the weights follow the radius itself, so a scale under 1 cuts the kernel
 * short and over 1 reads further out. A pair is read at the weighted mean of its two offsets, with
 * the sum of their weights, and the last texel of an odd run alone. A pair of no weight at all — a
 * radius so small its outer texels vanish, or a `cross` of 1 and over — stays on its first texel,
 * where the quotient of its weights would be undefined. A `cross` above 0 gives the centre texel a
 * share of the weight (`centreWeight`): the bell at 0, the bloom's cross at its own settings
 * (`bloomCross`).
 */
export function gaussianKernel(
  radius: number,
  taps: GaussianTaps,
  cross = 0,
  scale = 1,
  cap = UNROLLED_TAPS,
) {
  const sigma = clamp(radius, SMALLEST_RADIUS, cap - 1)
  const scaled = radius * clamp(scale, SMALLEST_SCALE, LARGEST_SCALE)
  const reach = Math.ceil(clamp(scaled, SMALLEST_RADIUS, cap - 1))
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
