import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import {
  CLOUD_SHADOW_BLOCK,
  writeCloudShadowBlock,
  type CloudShadowSet,
} from './cloudShadowRead.ts'

/**
 * THE CLOUDS' SHADE OF A SCENE WITH NO CLOUDS (`CloudShadowSet`): a map of no cloud for each light, a
 * block whose strengths are 0, a linear clamped sampler. Made once for a device and kept as long as it
 * lives: every program that reads the shade is given it where the clouds give none.
 */
export const cloudShadowStandIn = oncePerDevice((device: GPUDevice): CloudShadowSet => {
  const texture = device.createTexture({
    label: 'Trillion3D no cloud shade',
    size: { width: 1, height: 1 },
    format: 'rgba16float',
    usage: GPUTextureUsage.TEXTURE_BINDING,
  })
  const block = device.createBuffer({
    label: 'Trillion3D no cloud shade block',
    size: CLOUD_SHADOW_BLOCK.words * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
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
  const sampler = device.createSampler({
    label: 'Trillion3D cloud shade',
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  })
  return { maps: [view, view], sampler, block }
})
