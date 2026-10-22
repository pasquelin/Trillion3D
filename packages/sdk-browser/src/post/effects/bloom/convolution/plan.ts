/**
 * THE SIZES OF A CONVOLUTION BLOOM, on the CPU: at what fraction of the image it runs, which level of
 * the scene's chain it reads, how big the transform is and in which direction it goes first. The
 * image is convolved at `bloomScreenPercentage` of its size, read from the level of the scene's chain
 * nearest above that fraction and brought down to it by one bilinear read; the transform is the
 * image padded by half the kernel's reach — so the glow of the left edge does not come back in at the
 * right — and by zeros up to a power of two.
 */
import { floorLog2, nextPow2 } from '../../../../../../math/src/scalar/integers.ts'
import { clamp, clampCompare } from '../../../../../../math/src/scalar/reals.ts'
import { chainSizes } from '../../../filters/levelSizes.ts'
import type { TransformShape } from './transformShape.ts'

/** What bounds a transform on the device: the widest texture, the longest line the workgroup memory
 *  holds (`maxLine`), the most bytes a storage buffer binds (each of the two spectra is one). */
interface ConvolutionLimits {
  side: number
  maxLine: number
  bytes: number
}

/** The share of the image's size, from the level's, under which the transform is never planned: the
 *  least the resolution fraction takes. */
const LEAST_FRACTION = Math.fround(0.1)
/** Texels of a line the transform leaves free under the longest: the image of a level is brought down
 *  to a fraction by two roundings up, each at most one texel. */
const LINE_MARGIN = 3
/** The levels of the scene's chain a convolution reads, the coarsest first: the eighth, the quarter
 *  and the half of the image, each its share of it; past the half, the image itself (level -1). */
const LEVELS = [
  { level: 2, fraction: 0.125 },
  { level: 1, fraction: 0.25 },
  { level: 0, fraction: 0.5 },
] as const

/**
 * The fraction of the image the convolution runs at: `percent` of it, from 0.1 up to what the device
 * allows — half the widest texture over the image's longest side, and the longest line a workgroup
 * holds less a margin —, and no more than the image itself.
 */
function convolutionFraction(percent: number, view: readonly number[], limits: ConvolutionLimits) {
  const longest = Math.max(view[0], view[1])
  const most = Math.min((limits.side * 0.5) / longest, (limits.maxLine - LINE_MARGIN) / longest, 1)
  return clampCompare(Math.fround(Math.fround(percent) / 100), LEAST_FRACTION, most)
}

/** The level a convolution of fraction `fraction` reads: the coarsest one that holds it. */
function convolutionLevel(fraction: number) {
  for (const { level, fraction: share } of LEVELS) if (fraction <= share) return { level, share }
  return { level: -1, share: 1 }
}

/**
 * The padding of an image `image` for a kernel of `support` of its width, at most `buffer` of it: half
 * the kernel's reach, rounded up, and, where that would take a line past `maxLine`, no more than
 * fills it.
 */
function transformPadding(
  image: readonly number[],
  support: number,
  buffer: number,
  maxLine: number,
) {
  const reach = buffer > 0 ? Math.min(support, buffer) : support
  let radius = Math.ceil(Math.fround(0.5 * reach * image[0]))
  const longest = Math.max(image[0], image[1])
  if (longest + radius > maxLine && longest < maxLine) radius = maxLine - longest
  return radius
}

/** What a convolution of an image is made of (`planConvolution`). */
export interface ConvolutionPlan {
  /** The level of the scene's chain it reads, -1 the full image. */
  level: number
  /** The size of the image it reads. */
  input: [number, number]
  /** The size of the image it convolves. */
  image: [number, number]
  /** The size of the transform, each side a power of two. */
  frequency: [number, number]
  /** Whether the transform goes along the rows first. */
  horizontalFirst: boolean
  /** The kernel's width as a share of the image's, from 0 to 1. */
  support: number
  /** The fraction of the image the convolution runs at. */
  fraction: number
  /** Texels of one plane of the image's spectrum and of the kernel's: `columns` wide. */
  columns: number
  /** What the transform's passes read of the plan, for the image and for the kernel's resized
   *  picture, which fills the whole transform: each line of the first direction as long as the
   *  transform, as many lines as the transform is long across. */
  shapes: { image: TransformShape; kernel: TransformShape }
  /** The sizes, the support and the direction the kernel's transform depends on, as a word: two
   *  plans with the same one give the same kernel spectrum. */
  key: string
  /** Bytes of the image's four planes and of the kernel's four. */
  bytes: { image: number; kernel: number }
}

/** Bytes of a complex value of one channel. */
const COMPLEX_BYTES = 8

/** What a transform's passes read of a plan of the transform `frequency`, the image `image` and
 *  `columns` of a half spectrum, going along `along` first, for the image or the `kernel`. */
function shapeOf(
  [along, across]: readonly [number, number],
  frequency: readonly number[],
  image: readonly number[],
  columns: number,
  kernel: boolean,
): TransformShape {
  const lines = kernel ? frequency[across] : image[across]
  return {
    bitsAlong: floorLog2(frequency[along]),
    bitsAcross: floorLog2(frequency[across]),
    columns,
    horizontal: along === 0 ? 1 : 0,
    extent: kernel ? frequency[along] : image[along],
    lines,
    planeStride: lines * columns,
    kernelStride: frequency[across] * columns,
    convolve: kernel ? 0 : 1,
  }
}

/** The plan of the fraction `fraction` of the image `view`. */
function planAt(
  fraction: number,
  view: readonly number[],
  size: number,
  buffer: number,
  maxLine: number,
): ConvolutionPlan {
  const { level, share } = convolutionLevel(fraction)
  const input: [number, number] =
    level < 0 ? [view[0], view[1]] : chainSizes(view[0], view[1], level + 1)[level]
  const downscale = Math.fround(fraction / share)
  // The input is at least one texel and the downscale above 0: no side rounds up to less than one.
  const image: [number, number] = [
    Math.ceil(Math.fround(input[0] * downscale)),
    Math.ceil(Math.fround(input[1] * downscale)),
  ]
  const support = clamp(size, 0, 1)
  const radius = transformPadding(image, support, clamp(buffer, 0, 1), maxLine)
  const kernelSize = Math.ceil(Math.fround(support * Math.max(image[0], image[1])))
  const padded = [Math.max(image[0] + radius, kernelSize), Math.max(image[1] + radius, kernelSize)]
  // A kernel of size 0 over an image of one texel pads to nothing, and a transform of one value has no
  // stage (its loops would shift by 2³²−1): two values at least.
  const frequency: [number, number] = [
    Math.max(2, nextPow2(padded[0])),
    Math.max(2, nextPow2(padded[1])),
  ]
  const horizontalFirst = frequency[1] * padded[0] > frequency[0] * padded[1]
  const axes = horizontalFirst ? ([0, 1] as const) : ([1, 0] as const)
  const [along, across] = axes
  const columns = frequency[along] / 2 + 1
  return {
    level,
    input,
    image,
    frequency,
    horizontalFirst,
    support,
    fraction,
    columns,
    shapes: {
      image: shapeOf(axes, frequency, image, columns, false),
      kernel: shapeOf(axes, frequency, image, columns, true),
    },
    key: `${image}|${frequency}|${support}|${horizontalFirst}`,
    bytes: {
      image: 4 * image[across] * columns * COMPLEX_BYTES,
      kernel: 4 * frequency[across] * columns * COMPLEX_BYTES,
    },
  }
}

/** How many times the fraction may be lowered to fit the device, and by how much each time. */
const FIT_STEPS = 48
const FIT_FACTOR = 0.93

/** The settings a plan is made from. */
interface ConvolutionAsk {
  /** The image the chain was handed. */
  view: readonly number[]
  /** `bloomScreenPercentage`. */
  percent: number
  /** The kernel's size, `convolution.size`. */
  size: number
  /** The padding, `convolution.bufferScale`. */
  bufferScale: number
}

/**
 * The plan of a convolution of the image `ask.view`, as the settings ask. The reference transforms
 * along a line longer than the workgroup memory in several passes; this one lowers the fraction of
 * the image the convolution runs at until the lines and the buffers it needs fit the device
 * (`ConvolutionLimits`), which keeps the glow whole and a little softer.
 */
export function planConvolution(ask: ConvolutionAsk, limits: ConvolutionLimits): ConvolutionPlan {
  let fraction = convolutionFraction(ask.percent, ask.view, limits)
  let plan = planAt(fraction, ask.view, ask.size, ask.bufferScale, limits.maxLine)
  const fits = (p: ConvolutionPlan) =>
    Math.max(...p.frequency) <= limits.maxLine &&
    Math.max(p.bytes.image, p.bytes.kernel) <= limits.bytes
  for (let step = 0; step < FIT_STEPS && !fits(plan); step++) {
    fraction *= FIT_FACTOR
    plan = planAt(fraction, ask.view, ask.size, ask.bufferScale, limits.maxLine)
  }
  return plan
}
