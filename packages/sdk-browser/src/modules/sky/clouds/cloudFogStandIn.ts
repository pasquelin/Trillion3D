import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import { standInBuffer, standInTexture } from '../../../gpu/core/standIns.ts'
import { postSamplers } from '../../../gpu/core/postSamplers.ts'
import { CLOUD_FORMAT } from './reconstructLayout.ts'
import { CLOUD_FOG_BLOCK, type CloudFogSet } from './translucentRead.ts'

/**
 * THE CLOUD IMAGE OF A SCENE WITH NO CLOUD IMAGE (`CloudFogSet`): a texel of zeros each for the colour
 * and the depth, never read, and a block of zeros that says no image is bound, so that the layer of
 * every vertex is clear (`cloudFogOver`), as it is in a view with no cloud. Made once for a device
 * and kept as long as it lives: every program that reads the cloud image is given it where the
 * clouds left none, and a device that never asks makes none.
 */
export const cloudFogStandIn = oncePerDevice((device: GPUDevice): CloudFogSet => ({
  // A buffer starts as zeros: the block of no image.
  block: standInBuffer(
    device,
    'Trillion3D no cloud image block',
    CLOUD_FOG_BLOCK.words * 4,
    GPUBufferUsage.UNIFORM,
  ),
  colour: standInTexture(device, 'Trillion3D no cloud image colour', CLOUD_FORMAT).createView(),
  depth: standInTexture(device, 'Trillion3D no cloud image depth', CLOUD_FORMAT).createView(),
  sampler: postSamplers(device).clamped,
}))
