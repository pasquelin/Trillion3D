import type { wordViews } from '../../../../gpu/core/wordViews.ts'
import { FFT_PARAMS } from './fftWgsl.ts'

/** What a transform's passes read of a plan, for the image or for the kernel (`ConvolutionPlan.shapes`). */
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

/** Writes the transform's uniform (`FFT_PARAMS`) for `shape` into `words`, `scale` the multiplier of
 *  each channel after the inverse transform; the boost's words are the caller's. */
export function writeTransformWords(
  { u, f }: ReturnType<typeof wordViews>,
  shape: TransformShape,
  scale: readonly number[],
) {
  const at = FFT_PARAMS.at
  u.set([shape.bitsAlong, shape.bitsAcross, shape.columns, shape.horizontal], at.size)
  u.set([shape.extent, shape.lines, shape.planeStride, shape.kernelStride], at.rois)
  u[at.mode] = shape.convolve
  f.set(scale, at.scale)
}
