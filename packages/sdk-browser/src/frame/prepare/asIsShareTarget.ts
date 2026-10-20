import { AS_IS_SHARE_BYTES, createAsIsShare } from '../../lighting/deferred/asIsShare.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { readsAsIs } from './contractLight.ts'
import { drawsParticles } from '../../particles/gpu/webgpuParticleFrame.ts'
import { taaWanted } from '../backend/state/gpu.ts'
import type { ShareTargets } from '../../blend/blendTargets.ts'

/** Whether the transparents write the share: a blended image that can show a debug view,
 *  or whose temporal pass reads their coverage as the reactive value. */
export const blendWritesShare = (rt: WebgpuPagesRuntime) =>
  rt.blendState.blendGpu.length > 0 && (readsAsIs(rt) || taaWanted(rt.gpu))

/** The share targets the transparents write (`ShareTargets`): none without a share; the history
 *  given up beside it only where an item's surface gives some up (`givesUp`) to a temporal pass
 *  that reads it. A scene whose blends all keep their history pays no given-up target. */
export const blendShareTargets = (rt: WebgpuPagesRuntime): ShareTargets =>
  !blendWritesShare(rt) ? 0 : rt.blendState.givesUp && taaWanted(rt.gpu) ? 2 : 1

/** Whether this image's blend pass writes the history given up, which the seed then clears and the
 *  temporal pass reads (`blendShareTargets`). */
export const writesGivenUp = (rt: WebgpuPagesRuntime) =>
  !!rt.vis.blendPipelines && blendShareTargets(rt) === 2

/** Whether the image has a share target: its transparents or its particles (their coverage as the
 *  reactive value) write it. Any other scene draws and allocates what it did before. */
export const wantsAsIsShare = (rt: WebgpuPagesRuntime) => blendWritesShare(rt) || drawsParticles(rt)

/** The share target at `width`×`height`, over the opaque flags: made with the targets or later. */
export function makeAsIsShare(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  width: number,
  height: number,
) {
  rt.gpu.asIsShare = createAsIsShare(device, rt.gpu.surfaces!.views()[3], width, height)
}

/** The share the transparents blend into this image, when they write one (`blendWritesShare`). */
export const activeAsIsShare = (rt: WebgpuPagesRuntime) =>
  blendWritesShare(rt) ? rt.gpu.asIsShare : undefined

/** Releases the share target and its cost, when there is one. */
function releaseAsIsShare(rt: WebgpuPagesRuntime) {
  const { gpu } = rt
  if (!gpu.asIsShare) return
  const [width, height] = gpu.allocatedSize
  gpu.asIsShare.dispose()
  gpu.asIsShare = undefined
  gpu.targetBytes -= width * height * AS_IS_SHARE_BYTES
}

/**
 * Seeds, from the opaque flags, the share the transparents and particles blend into this image,
 * and returns it: the one made with the targets, or one made at the first image that wants it and
 * kept with them. An image where neither writes it runs no seed pass and returns nothing; one that
 * no longer wants it at all (`wantsAsIsShare`, a debug view turned off) releases it.
 */
export function seedAsIsShare(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
) {
  const { gpu } = rt
  const written = (!!rt.vis.blendPipelines && blendWritesShare(rt)) || drawsParticles(rt)
  if (!wantsAsIsShare(rt)) releaseAsIsShare(rt)
  if (!written || !gpu.surfaces) return undefined
  if (!gpu.asIsShare) {
    const [width, height] = gpu.allocatedSize
    gpu.targetBytes += width * height * AS_IS_SHARE_BYTES
    makeAsIsShare(rt, device, width, height)
  }
  gpu.asIsShare!.seed(encoder, readsAsIs(rt), writesGivenUp(rt))
  return gpu.asIsShare
}
