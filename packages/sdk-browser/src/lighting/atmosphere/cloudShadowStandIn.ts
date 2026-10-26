import { postSamplers } from '../../gpu/core/postSamplers.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { standInBuffer, standInTexture } from '../../gpu/core/standIns.ts'
import {
  CLOUD_SHADOW_BLOCK,
  writeCloudShadowBlock,
  type CloudShadowSet,
} from './cloudShadowRead.ts'

/**
 * THE CLOUDS' SHADE OF A SCENE WITH NO CLOUDS (`CloudShadowSet`): a map of no cloud for each light and
 * for the sky occlusion, a block whose strengths and sky far depth are 0, a linear clamped sampler.
 * Made once for a device and kept as long as it lives: every program that reads the shade is given
 * it where the clouds give none.
 */
export const cloudShadowStandIn = oncePerDevice((device: GPUDevice): CloudShadowSet => {
  const texture = standInTexture(device, 'Trillion3D no cloud shade', 'rgba16float')
  const block = standInBuffer(
    device,
    'Trillion3D no cloud shade block',
    CLOUD_SHADOW_BLOCK.words * 4,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  )
  device.queue.writeBuffer(
    block,
    0,
    writeCloudShadowBlock(
      new Float32Array(CLOUD_SHADOW_BLOCK.words),
      [undefined, undefined],
      [0, 0, 0],
    ),
  )
  const view = texture.createView()
  const sampler = postSamplers(device).clamped
  return { maps: [view, view], ao: view, sampler, block }
})
