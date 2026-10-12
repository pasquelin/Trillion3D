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

/** The entries of the Hi-Z kernel's group over a laid `pyramid`: the test never reads level 0 nor
 *  the front depth, which `level0` stands for. */
export function hizEntries(
  pyramid: GPUTexture,
  level0: GPUTexture,
  uniform: GPUBindingResource,
  buffers: GPUBuffer[],
): GPUBindGroupEntry[] {
  return [
    { binding: 0, resource: pyramid.createView({ dimension: '2d-array' }) },
    { binding: 1, resource: level0.createView() },
    { binding: 2, resource: uniform },
    ...buffers.map((buffer, k) => ({ binding: 3 + k, resource: { buffer } })),
    { binding: 6, resource: level0.createView() },
  ]
}
