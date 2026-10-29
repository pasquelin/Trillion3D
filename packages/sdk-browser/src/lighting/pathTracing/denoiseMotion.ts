import {
  DN_MIP_STEP,
  DN_SLICES,
  blurSize,
  removesSelfOffset,
  usesSubPixel,
  usesTotalVariation,
} from './denoiseParams.ts'
import { DN_FLAG_SUBPIXEL, DN_FLAG_TOTAL_VARIATION } from './denoiseMotionWgsl.ts'
import { arrayView, layerView, levelView, type DenoisePasses } from './denoisePasses.ts'
import type { DenoiseGpu, DenoiseMotion } from './denoiseGpu.ts'
import type { DenoisePipelines } from './denoisePipelines.ts'
import type { PathTracingSettings } from './framePlan.ts'

/** What the motion estimate is run with. */
export interface MotionContext {
  readonly passes: DenoisePasses
  readonly pipelines: DenoisePipelines
  readonly dgpu: DenoiseGpu
  readonly motion: DenoiseMotion
  readonly settings: PathTracingSettings
}

const extentAt = (size: readonly [number, number], level: number) =>
  [Math.max(size[0] >> level, 1), Math.max(size[1] >> level, 1)] as const

/** The pyramid `texture` made from `source`: the first level a copy, each of the others the bilinear half of the one before. */
export function fillPyramid(
  { passes, pipelines, dgpu }: MotionContext,
  texture: GPUTexture,
  source: GPUTexture,
) {
  const levels = texture.mipLevelCount
  passes.run(
    pipelines.mip,
    {},
    [
      { binding: 1, resource: source.createView() },
      { binding: 2, resource: levelView(texture, 0) },
    ],
    dgpu.size[0],
    dgpu.size[1],
  )
  for (let level = 1; level < levels; level++) {
    const [width, height] = extentAt(dgpu.size, level)
    passes.run(
      pipelines.mip,
      {},
      [
        { binding: 1, resource: levelView(texture, level - 1) },
        { binding: 2, resource: levelView(texture, level) },
      ],
      width,
      height,
    )
  }
}

/** The distances of a level, blurred layer by layer: horizontal-and-vertical pairs of 3 by 3 taps, as many as the level asks (`blurSize`). */
function blurDistances(
  { passes, pipelines, motion }: MotionContext,
  mip: number,
  width: number,
  height: number,
) {
  for (let layer = 0; layer < DN_SLICES; layer++) {
    for (let at = 0; at < blurSize(mip); at++) {
      passes.run(
        pipelines.blur,
        { mip },
        [
          { binding: 1, resource: layerView(motion.distances, layer, mip) },
          { binding: 2, resource: levelView(motion.blur, mip) },
        ],
        width,
        height,
      )
      passes.run(
        pipelines.blur,
        { mip },
        [
          { binding: 1, resource: levelView(motion.blur, mip) },
          { binding: 2, resource: layerView(motion.distances, layer, mip) },
        ],
        width,
        height,
      )
    }
  }
}

/** The distances of the 25 shifts of `newer` against `older` at a level, blurred, then the best shift merged into `target`'s level with the motion `previous` (the level two coarser) added. */
function alignAndMerge(
  context: MotionContext,
  mip: number,
  patchId: number,
  [older, newer]: readonly [GPUTexture, GPUTexture],
  previous: GPUTextureView,
  target: GPUTexture,
) {
  const { passes, pipelines, motion, settings } = context
  const [width, height] = extentAt(context.dgpu.size, mip)
  const flags =
    (usesSubPixel(settings, mip) ? DN_FLAG_SUBPIXEL : 0) |
    (usesTotalVariation(settings, mip) ? DN_FLAG_TOTAL_VARIATION : 0)
  passes.run(
    pipelines.align,
    { mip, metric: settings.pathTracingTemporalDenoiserDistanceMetrics },
    [
      { binding: 1, resource: previous },
      { binding: 2, resource: older.createView() },
      { binding: 3, resource: newer.createView() },
      { binding: 4, resource: arrayView(motion.distances, mip) },
    ],
    width,
    height,
    DN_SLICES,
  )
  blurDistances(context, mip, width, height)
  passes.run(
    pipelines.merge,
    { mip, patchId, flags },
    [
      { binding: 1, resource: previous },
      { binding: 2, resource: arrayView(motion.distances) },
      { binding: 3, resource: levelView(target, mip) },
    ],
    width,
    height,
  )
}

/**
 * THE MOTION OF THE NEWER IMAGE AGAINST THE OLDER, level by level down the pyramid, two levels at a time (the coarsest first): at each, the image's own motion against itself when the level asks (its
 * error is what the sub-pixel fit leaves), the motion of the newer image against the older one, searched around where the coarser level pointed, and the first minus the second. The `patchId`th best match is
 * taken at the finest levels (more than one patch is the bilateral accumulation of several candidates). Returns the finest level's texture, the motion with its distance to the match and its total variation.
 */
export function estimateMotion(context: MotionContext, patchId: number) {
  const { passes, pipelines, motion, settings, dgpu } = context
  const pair = [motion.older, motion.newer] as const
  const empty = dgpu.empty.createView()
  const levels = motion.offsets.mipLevelCount
  for (let mip = levels - 1; mip >= 0; mip -= DN_MIP_STEP) {
    const previous = mip === levels - 1 ? empty : levelView(motion.offsets, mip + DN_MIP_STEP)
    const own = removesSelfOffset(settings, mip)
    if (own) alignAndMerge(context, mip, patchId, [motion.older, motion.older], empty, motion.own)
    alignAndMerge(context, mip, patchId, pair, previous, own ? motion.merged : motion.offsets)
    if (own) {
      const [width, height] = extentAt(dgpu.size, mip)
      passes.run(
        pipelines.subtract,
        { mip },
        [
          { binding: 1, resource: levelView(motion.merged, mip) },
          { binding: 2, resource: levelView(motion.own, mip) },
          { binding: 3, resource: levelView(motion.offsets, mip) },
        ],
        width,
        height,
      )
    }
  }
  return motion.offsets
}
