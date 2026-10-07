import { readGpuImage } from '../../../gpu/core/readback.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import { type SpatialFeedback, textureKinds, spatialMipCounts } from './spatialCounts.ts'

/** Scene-level mip evidence from the last submitted r32uint feedback image. */
export async function feedbackAbSpatial(rt: WebgpuPagesRuntime): Promise<SpatialFeedback> {
  const device = rt.gpu.device,
    target = rt.gpu.feedbackTexture,
    textures = rt.vis.textures
  if (!rt.feedbackAB?.target || !device || !target || !textures)
    throw new Error('FEEDBACK_AB_SPATIAL_UNAVAILABLE')
  const [width, height] = rt.gpu.targetSize
  if (!width || !height || !rt.run.imageRevision) throw new Error('FEEDBACK_AB_IMAGE_MISSING')
  const bytes = await readGpuImage(device, target, width, height, rt.signal)
  return spatialMipCounts(
    new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4),
    width,
    height,
    textures,
    textureKinds(rt),
  )
}
