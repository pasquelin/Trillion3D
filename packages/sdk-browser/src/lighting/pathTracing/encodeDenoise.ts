import { ledgerAdmitted, ledgerRoom } from '../../gpu/core/deviceLedger.ts'
import { DN_FLAG_HAS_VARIANCE, DN_SPATIAL_PASSES } from './denoiseSpatialWgsl.ts'
import { DN_FLAG_RANKED, DN_FLAG_SINGLE_CHANNEL } from './denoisePrepassWgsl.ts'
import { DenoiseGpu, denoiseBytes, denoiseKey, type DenoiseNeeds } from './denoiseGpu.ts'
import { estimateMotion, fillPyramid, type MotionContext } from './denoiseMotion.ts'
import {
  blendingFactors,
  keepsFeatureHistory,
  sourceIsFusion,
  wantsVarianceMap,
  wantsVarianceTexture,
} from './denoiseParams.ts'
import { DenoisePasses, levelView } from './denoisePasses.ts'
import type { DenoisePipelines } from './denoisePipelines.ts'
import type { PathTracingFrame, PathTracingSettings } from './framePlan.ts'
import type { PathTracingGpu } from './gpuState.ts'

/** What the denoiser holds of a view between images: its resources, which of the two variance maps is worked on and which holds the last finished run, and which image is the last denoised. */
export interface DenoiseState {
  gpu?: DenoiseGpu
  bytes: number
  refused?: { key: string; room: number }
  working?: 0 | 1
  finished?: 0 | 1
  /** The index of the last denoised image in `DenoiseGpu.frames`, none before the first. */
  last?: number
}

export const newDenoiseState = (): DenoiseState => ({ bytes: 0 })

/** The history of the denoiser forgotten: the next denoised image has no earlier one (a restart, a new size). */
export function forgetDenoiseHistory(state: DenoiseState) {
  state.last = undefined
  state.finished = undefined
}

/** The resources the settings ask of the denoiser. */
export const denoiseNeedsOf = (settings: PathTracingSettings): DenoiseNeeds => ({
  temporal: settings.pathTracingTemporalDenoiser,
  feature: keepsFeatureHistory(settings),
  fusion:
    settings.pathTracingTemporalDenoiser &&
    sourceIsFusion(settings.pathTracingTemporalDenoiserSource),
  patches: settings.pathTracingTemporalDenoiser
    ? settings.pathTracingTemporalDenoiserPatchCount
    : 1,
})

/** Lets the denoiser's resources go. */
export function releaseDenoise(state: DenoiseState) {
  state.gpu?.destroy()
  state.gpu = undefined
  state.bytes = 0
  forgetDenoiseHistory(state)
}

/** The denoiser's resources for a view of `size` and these needs: the ones held where they fit, else made again (the history lost) within the device's budget; none where the budget refuses. */
export function denoiseGpuOf(
  device: GPUDevice,
  state: DenoiseState,
  size: readonly [number, number],
  needs: DenoiseNeeds,
) {
  const key = denoiseKey(size, needs)
  if (state.gpu?.key === key && state.gpu.device === device) return state.gpu
  if (state.refused?.key === key && state.refused.room === ledgerRoom(device)) return undefined
  const old = state.gpu
  const held = old && { bytes: state.bytes, dispose: () => old.destroy() }
  state.gpu = undefined
  forgetDenoiseHistory(state)
  const asked = denoiseBytes(device, size, needs)
  const admitted = ledgerAdmitted(device, {
    held,
    asked,
    what: 'the path tracer denoiser',
    make: () => new DenoiseGpu(device, size, needs),
  })
  if (!admitted.value) {
    state.refused = { key, room: ledgerRoom(device) }
    state.bytes = 0
    return undefined
  }
  state.refused = undefined
  state.gpu = admitted.value
  state.bytes = asked
  return admitted.value
}

/** What the draw of the denoiser's views needs: the motion found and the history it warped. */
export interface DenoiseViews {
  readonly motion: GPUTextureView
  readonly history: GPUTextureView
}

export interface DenoiseImage {
  readonly device: GPUDevice
  readonly encoder: GPUCommandEncoder
  readonly pipelines: DenoisePipelines
  readonly gpu: PathTracingGpu
  readonly dgpu: DenoiseGpu
  readonly state: DenoiseState
  readonly settings: PathTracingSettings
  readonly frame: PathTracingFrame
  /** The sample just traced (the index the prepass is at) and the image of the ping-pong that holds the accumulation. */
  readonly iteration: number
  readonly image: 0 | 1
  /** The pre-exposure of the image to the run's: the scale colours are compared at. */
  readonly exposure: number
}

/** What the denoiser did: whether a denoised image was made, and, where the temporal stage ran, what the views draw. */
export interface DenoiseOutcome {
  readonly denoised: boolean
  readonly views: DenoiseViews | undefined
}

function encodePrepass(input: DenoiseImage, passes: DenoisePasses) {
  const { pipelines, dgpu, state, settings, frame, gpu, image, iteration } = input
  if (!wantsVarianceMap(settings)) return undefined
  const images = gpu.images[image]
  const [width, height] = dgpu.size
  let working = state.finished
  if (frame.needsMoreRays) {
    state.working ??= state.finished === 0 ? 1 : 0
    working = state.working
    const single = settings.pathTracingDenoiserVarianceType === 1
    const flags =
      (single ? DN_FLAG_SINGLE_CHANNEL : 0) |
      (single && settings.pathTracingDenoiserRankedLuminanceVariance ? DN_FLAG_RANKED : 0)
    passes.run(
      pipelines.prepass,
      { iteration, flags },
      [
        { binding: 1, resource: images.radiance.createView() },
        { binding: 2, resource: images.albedo.createView() },
        { binding: 3, resource: images.normal.createView() },
        { binding: 4, resource: { buffer: dgpu.varianceMaps[working] } },
      ],
      width,
      height,
    )
  }
  if (wantsVarianceTexture(settings) && working !== undefined)
    passes.run(
      pipelines.texture,
      { iteration: Math.min(iteration, frame.maxSamples - 1) },
      [
        { binding: 1, resource: { buffer: dgpu.varianceMaps[working] } },
        { binding: 2, resource: dgpu.varianceTexture.createView() },
      ],
      width,
      height,
    )
  return working
}

/** The spatial stage: the filter run in `DN_SPATIAL_PASSES` passes, the radiance in, the denoised image `into` out, the scratch between. */
function encodeSpatial(
  input: DenoiseImage,
  passes: DenoisePasses,
  into: GPUTexture,
  variance: boolean,
) {
  const { pipelines, dgpu, gpu, image, settings } = input
  const images = gpu.images[image]
  const [width, height] = dgpu.size
  const normals = settings.pathTracingDenoiserNormalSpace !== 0 ? gpu.cameraNormals : images.normal
  const flags =
    (variance ? DN_FLAG_HAS_VARIANCE : 0) |
    (settings.pathTracingDenoiserVarianceType === 1 ? DN_FLAG_SINGLE_CHANNEL : 0)
  for (let at = 0; at < DN_SPATIAL_PASSES; at++) {
    const source = at === 0 ? images.radiance : at % 2 === 1 ? dgpu.scratch : into
    passes.run(
      pipelines.spatial,
      { iteration: at, flags },
      [
        { binding: 1, resource: source.createView() },
        { binding: 2, resource: images.albedo.createView() },
        { binding: 3, resource: normals.createView() },
        { binding: 4, resource: dgpu.varianceTexture.createView() },
        { binding: 5, resource: (at % 2 === 0 ? dgpu.scratch : into).createView() },
      ],
      width,
      height,
    )
  }
}

/** The textures the motion is estimated on: by `...Source`, the last denoised image against the new, the normals, the albedo, the raw radiance, or the fusion of the variances. */
function motionImages(
  input: DenoiseImage,
  passes: DenoisePasses,
  older: GPUTexture,
  newer: GPUTexture,
  variance: 0 | 1 | undefined,
) {
  const { dgpu, gpu, image, settings, state, pipelines } = input
  const images = gpu.images[image]
  const { history, motion } = dgpu
  switch (settings.pathTracingTemporalDenoiserSource) {
    case 0:
      return [older, newer] as const
    case 1:
      return history && ([history.normal, images.normal] as const)
    case 2:
      return history && ([history.albedo, images.albedo] as const)
    case 3:
      return history && ([history.radiance, images.radiance] as const)
    default: {
      const [width, height] = dgpu.size
      if (variance === undefined || !motion?.fusedOlder || !motion.fusedNewer) return undefined
      passes.run(
        pipelines.fusion,
        {},
        [
          { binding: 1, resource: { buffer: dgpu.varianceMaps[state.finished ?? variance] } },
          { binding: 2, resource: { buffer: dgpu.varianceMaps[variance] } },
          { binding: 3, resource: motion.fusedOlder.createView() },
          { binding: 4, resource: motion.fusedNewer.createView() },
        ],
        width,
        height,
      )
      return [motion.fusedOlder, motion.fusedNewer] as const
    }
  }
}

/** The temporal stage: the motion from the last denoised image to `newer`, then the blend of the warped history into `newer`, patch by patch, into `final`. */
function encodeTemporal(
  input: DenoiseImage,
  passes: DenoisePasses,
  older: GPUTexture,
  newer: GPUTexture,
  final: GPUTexture,
  variance: 0 | 1 | undefined,
): DenoiseViews | undefined {
  const { dgpu, settings, pipelines } = input
  const motion = dgpu.motion
  if (!motion) return undefined
  const images = motionImages(input, passes, older, newer, variance)
  if (!images) return undefined
  const context: MotionContext = { passes, pipelines, dgpu, motion, settings }
  fillPyramid(context, motion.older, images[0])
  fillPyramid(context, motion.newer, images[1])
  const { kappa, eta, alpha } = blendingFactors(settings)
  const cutoff = Math.max(1, settings.pathTracingTemporalDenoiserDeltaEHighFrequency)
  const patchCount = settings.pathTracingTemporalDenoiserPatchCount
  const [width, height] = dgpu.size
  const at = levelView(motion.offsets, 0)
  for (let patchId = 0; patchId < patchCount; patchId++) {
    estimateMotion(context, patchId)
    passes.run(
      pipelines.reject,
      { cutoff },
      [
        { binding: 1, resource: at },
        { binding: 2, resource: older.createView() },
        { binding: 3, resource: newer.createView() },
        { binding: 4, resource: motion.reject.createView() },
      ],
      width,
      height,
    )
    const last = patchId + 1 === patchCount
    const into = last ? final : motion.sums[patchId % 2]!
    const from = patchId === 0 ? newer : motion.sums[(patchId - 1) % 2]!
    passes.run(
      pipelines.resolve,
      { patchId, patchCount, kappa, eta, alpha, cutoff },
      [
        { binding: 1, resource: at },
        { binding: 2, resource: older.createView() },
        { binding: 3, resource: from.createView() },
        { binding: 4, resource: motion.reject.createView() },
        { binding: 5, resource: newer.createView() },
        { binding: 6, resource: into.createView() },
      ],
      width,
      height,
    )
  }
  return { motion: at, history: older.createView() }
}

/**
 * THE DENOISER OF AN IMAGE, in the order the reference runs it: the prepass keeps each pixel's mean and variance while samples are gathered; when it is time to denoise (`frame.denoise`), the spatial
 * stage filters the radiance (or the radiance is kept as it is), the temporal stage blends the last denoised image, warped by the motion found between the two, into it where one is held, the features of the image
 * are kept for the next, and the variance run is finished. Returns the image the display shows (the last denoised one, none before the first) and what the views draw.
 */
export function encodeDenoise(
  input: DenoiseImage,
): DenoiseOutcome & { shown: GPUTexture | undefined } {
  const { device, encoder, dgpu, state, settings, frame, gpu, image } = input
  const images = gpu.images[image]
  const frames = dgpu.frames
  const shownOf = () => (state.last === undefined ? undefined : frames[state.last])
  if (!frame.stages.includes('denoiserPrepass'))
    return { denoised: false, views: undefined, shown: shownOf() }
  const target = [0, 1, 2].find((at) => at !== state.last && at < frames.length)!
  const final = [0, 1, 2].find((at) => at !== state.last && at !== target && at < frames.length)
  const spatial = settings.pathTracingSpatialDenoiser
  if (frame.denoise && !spatial)
    encoder.copyTextureToTexture(
      { texture: images.radiance },
      { texture: frames[target]! },
      dgpu.size,
    )
  const passes = new DenoisePasses(device, encoder, dgpu, input.exposure)
  const variance = encodePrepass(input, passes)
  let views: DenoiseViews | undefined
  let shown = target
  if (frame.denoise) {
    if (spatial)
      encodeSpatial(
        input,
        passes,
        frames[target]!,
        variance !== undefined && wantsVarianceTexture(settings),
      )
    const older = state.last === undefined ? undefined : frames[state.last]
    if (frame.stages.includes('temporalDenoiser') && older && final !== undefined) {
      views = encodeTemporal(input, passes, older, frames[target]!, frames[final]!, variance)
      if (views) shown = final
    }
  }
  passes.finish()
  if (!frame.denoise) return { denoised: false, views: undefined, shown: shownOf() }
  const history = dgpu.history
  if (history) {
    encoder.copyTextureToTexture(
      { texture: images.radiance },
      { texture: history.radiance },
      dgpu.size,
    )
    encoder.copyTextureToTexture({ texture: images.albedo }, { texture: history.albedo }, dgpu.size)
    encoder.copyTextureToTexture({ texture: images.normal }, { texture: history.normal }, dgpu.size)
  }
  state.last = shown
  if (wantsVarianceMap(settings)) {
    state.finished = state.working ?? state.finished
    state.working = undefined
  }
  return { denoised: true, views, shown: frames[shown] }
}
