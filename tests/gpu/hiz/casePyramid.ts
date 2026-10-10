// A case's pyramid laid in the farthest layer of the engine's pyramid texture, as the Hi-Z test
// kernel reads it.
import {
  HIZ_FARTHEST,
  HIZ_FORMAT,
  hizTextureSize,
} from '../../../packages/sdk-browser/src/gpu/hiz/pyramidTexture.ts'
import { hizFarthestLayer } from '../../../packages/sdk-browser/src/gpu/hiz/oracle.fixture.ts'

export function laidPyramid(device: GPUDevice, packed: Float32Array<ArrayBuffer>) {
  const pyramid = device.createTexture({
    size: hizTextureSize(packed.length),
    format: HIZ_FORMAT,
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST,
  })
  const layer = hizFarthestLayer(packed)
  device.queue.writeTexture(
    { texture: pyramid, origin: [0, 0, HIZ_FARTHEST] },
    layer.words,
    { bytesPerRow: layer.width * 4 },
    [layer.width, layer.height, 1],
  )
  return pyramid
}
