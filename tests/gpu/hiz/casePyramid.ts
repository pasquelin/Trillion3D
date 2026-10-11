// A case's pyramid laid in the culling farthest layer of the engine's pyramid texture, as the Hi-Z
// test kernel reads it.
import {
  HIZ_CULL_FARTHEST,
  HIZ_FORMAT,
  hizTextureSize,
} from '../../../packages/sdk-browser/src/gpu/hiz/pyramidTexture.ts'
import {
  hizLayerWords,
  type PackedHiz,
} from '../../../packages/sdk-browser/src/gpu/hiz/oracle.fixture.ts'

export function laidPyramid(device: GPUDevice, packed: PackedHiz) {
  const pyramid = device.createTexture({
    size: hizTextureSize(packed),
    format: HIZ_FORMAT,
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST,
  })
  const layers = hizLayerWords(packed, HIZ_CULL_FARTHEST)
  for (const [slice, words] of layers.layers)
    device.queue.writeTexture(
      { texture: pyramid, origin: [0, 0, slice] },
      words,
      { bytesPerRow: layers.width * 4 },
      [layers.width, layers.height, 1],
    )
  return pyramid
}
