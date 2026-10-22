import { FFT_PARAMS } from './fftWgsl.ts'
import { NORMALISED_BY, SCALED_BY, type Vec4 } from './kernelStats.ts'
import { lineBits, type ConvolutionPlan } from './plan.ts'

/** What a transform's passes read of a plan, for the image or for the kernel (`transformShape`). */
export interface TransformShape {
  /** The base-two logarithms of the line along the first direction and of the line across it. */
  bitsAlong: number
  bitsAcross: number
  /** The columns of a half spectrum. */
  columns: number
  /** 1 where the first transform goes along x. */
  horizontal: number
  /** The texels of a line the picture holds, along the first direction. */
  extent: number
  /** The lines the picture holds across it. */
  lines: number
  /** The complex values of one plane of the picture's spectrum, and of the kernel's. */
  planeStride: number
  kernelStride: number
  /** 1 where the columns pass multiplies by the kernel's spectrum. */
  convolve: number
}

/** The shapes of a plan, the image's then the kernel's, made at the first ask. */
const SHAPES = new WeakMap<ConvolutionPlan, TransformShape[]>()

/**
 * The shape of the transform of the image of a plan, or, with `kernel`, of the kernel's resized
 * picture, which fills the whole transform: each line of the first direction as long as the
 * transform, as many lines as the transform is long across. One object a plan and a kind: an
 * image allocates none.
 */
export function transformShape(plan: ConvolutionPlan, kernel: boolean) {
  let shapes = SHAPES.get(plan)
  if (!shapes) SHAPES.set(plan, (shapes = []))
  return (shapes[Number(kernel)] ??= shapeOf(plan, kernel))
}

function shapeOf(plan: ConvolutionPlan, kernel: boolean): TransformShape {
  const [along, across] = plan.horizontalFirst ? [0, 1] : [1, 0]
  const lines = kernel ? plan.frequency[across] : plan.image[across]
  return {
    bitsAlong: lineBits(plan.frequency[along]),
    bitsAcross: lineBits(plan.frequency[across]),
    columns: plan.columns,
    horizontal: plan.horizontalFirst ? 1 : 0,
    extent: kernel ? plan.frequency[along] : plan.image[along],
    lines,
    planeStride: lines * plan.columns,
    kernelStride: plan.frequency[across] * plan.columns,
    convolve: kernel ? 0 : 1,
  }
}

/** The multiplier of each channel after the inverse transform, from the glow's multiplier: red,
 *  green, blue and alpha take `SCALED_BY`'s component (`./kernelStats.ts` says why blue takes red's). */
export const channelScale = (multiply: Vec4): Vec4 =>
  SCALED_BY.map((c) => multiply[c]) as unknown as Vec4

/** Writes the transform's uniform (`FFT_PARAMS`) for `shape` into `words`, `scale` the multiplier of
 *  each channel after the inverse transform. */
export function writeTransformWords(
  words: Float32Array,
  shape: TransformShape,
  scale: readonly number[],
) {
  const at = FFT_PARAMS.at
  const u32 = new Uint32Array(words.buffer, words.byteOffset, words.length)
  u32.set([shape.bitsAlong, shape.bitsAcross, shape.columns, shape.horizontal], at.size)
  u32.set([shape.extent, shape.lines, shape.planeStride, shape.kernelStride], at.rois)
  u32.set([shape.convolve, 0, 0, 0], at.mode)
  u32.set(NORMALISED_BY, at.normBy)
  words.set(scale, at.scale)
}
