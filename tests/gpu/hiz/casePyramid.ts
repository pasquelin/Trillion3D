// A case's pyramid laid in the culling farthest layer of the engine's pyramid texture, as the Hi-Z
// test kernel reads it.
import {
  HIZ_CULL_FARTHEST,
  HIZ_FORMAT,
  hizTextureSize,
} from '../../../packages/sdk-browser/src/gpu/hiz/pyramidTexture.ts'
import { hizBindEntries } from '../../../packages/sdk-browser/src/gpu/hiz/shader.ts'
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

/** The entries of the Hi-Z kernel's group over a laid `pyramid`, one for each entry of the shipped
 *  layout (`hizBindEntries`) by its kind: the test never reads level 0 nor the front depth, which
 *  `level0` stands for; `buffers` fill the storage bindings in order. */
export function hizEntries(
  pyramid: GPUTexture,
  level0: GPUTexture,
  uniform: GPUBindingResource,
  buffers: GPUBuffer[],
): GPUBindGroupEntry[] {
  const storage = [...buffers]
  return hizBindEntries(0).map(({ binding, storageTexture, texture, buffer }) => ({
    binding,
    resource: storageTexture
      ? pyramid.createView({ dimension: '2d-array' })
      : texture
        ? level0.createView()
        : buffer?.type === 'uniform'
          ? uniform
          : { buffer: storage.shift()! },
  }))
}
