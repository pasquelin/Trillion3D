import {
  computeSamplerEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
  COMPUTE,
} from '../../gpu/core/computeBindings.ts'
import { texelBytesOf } from '../../gpu/core/textureBytes.ts'
import { EngineError } from '../../../../sdk-core/src/contracts/cache.ts'
import type {
  VolumetricLightmapData,
  VolumetricLightmapFormat,
  VolumetricLightmapLayer,
} from '../../../../sdk-core/src/lighting/volumetricLightmapFile.ts'

/**
 * The volumetric lightmap's textures: nine 3D textures, one a layer of the file, in the order of
 * the bindings of `sampleWgsl.ts` — the indirection volume, the ambient, the six coefficient
 * layers, the sky's bent normal. A lightmap that is absent, or has no bent normal, is bound as a
 * black texture of one texel, as the sampling then reads black. A program that reads the lightmap
 * spends eight of its sixteen sampled textures and one read-only storage texture.
 */

/** The nine textures and their views, made once for a lightmap. */
export interface VolumetricLightmapTextures {
  readonly views: readonly GPUTextureView[]
  /** The textures themselves, in binding order, which a streamed cell is written into. */
  readonly textures: readonly GPUTexture[]
  /** Frees the textures. */
  destroy(): void
}

/** The layers in binding order: the file's, with the bent normal's place held by `undefined`
 *  where the file has none. */
const layersOf = (data: VolumetricLightmapData) => [
  data.indirection,
  data.ambient,
  ...data.coefficients,
  data.skyBentNormal,
]

const FORMATS: readonly VolumetricLightmapFormat[] = [
  'rgba8uint',
  'rg11b10ufloat',
  ...Array<VolumetricLightmapFormat>(7).fill('rgba8unorm'),
]

/** The texture of one layer, `size` texels (`room` where the volume has room for more than the
 *  layer holds), the layer written into its first `size`; a texel of black where `layer` is `undefined`. */
function layerTexture(
  device: GPUDevice,
  format: VolumetricLightmapFormat,
  layer: VolumetricLightmapLayer | undefined,
  [size, room]: readonly [readonly [number, number, number], readonly [number, number, number]],
  label: string,
) {
  const [width, height, depthOrArrayLayers] = layer ? size : [1, 1, 1]
  const [roomWidth, roomHeight, roomDepth] = layer ? room : [1, 1, 1]
  const texture = device.createTexture({
    label,
    dimension: '3d',
    size: { width: roomWidth, height: roomHeight, depthOrArrayLayers: roomDepth },
    format,
    usage:
      (format === 'rgba8uint' ? GPUTextureUsage.STORAGE_BINDING : GPUTextureUsage.TEXTURE_BINDING) |
      GPUTextureUsage.COPY_DST,
  })
  if (layer)
    device.queue.writeTexture(
      { texture },
      layer.bytes as Uint8Array<ArrayBuffer>,
      { bytesPerRow: width * texelBytesOf(format), rowsPerImage: height },
      { width, height, depthOrArrayLayers },
    )
  return texture
}

/** The textures of `data`, or the black ones where there is none; the atlas `atlas` texels wide
 *  where bricks stream into it, `data`'s own else. A volume past the device's 3D limit throws
 *  `INVALID_CACHE`; a refusal of the budget leaves nothing made. */
export function createVolumetricLightmapTextures(
  device: GPUDevice,
  data: VolumetricLightmapData | undefined,
  label = 'Trillion3D volumetric lightmap',
  atlas: readonly [number, number, number] | undefined = data?.atlasSize,
): VolumetricLightmapTextures {
  const limit = device.limits.maxTextureDimension3D
  if (data && [...data.indirectionSize, ...(atlas ?? data.atlasSize)].some((side) => side > limit))
    throw new EngineError(
      'INVALID_CACHE',
      `the volumetric lightmap exceeds the ${limit}-texel 3D limit`,
      {},
    )
  const layers = data ? layersOf(data) : Array(FORMATS.length).fill(undefined)
  const made: GPUTexture[] = []
  try {
    for (const [k, layer] of layers.entries()) {
      const own = k === 0 ? data?.indirectionSize : data?.atlasSize
      const room = k === 0 ? own : atlas
      const sizes = [own ?? [1, 1, 1], room ?? [1, 1, 1]] as const
      made.push(layerTexture(device, FORMATS[k], layer, sizes, `${label} ${k}`))
    }
  } catch (error) {
    for (const texture of made) texture.destroy()
    throw error
  }
  return {
    textures: made,
    views: made.map((texture) => texture.createView({ dimension: '3d' })),
    destroy: () => made.forEach((texture) => texture.destroy()),
  }
}

/** The layout entries of the lightmap's bindings from `first`: the view block, the sampler, the
 *  textures — the indirection a read-only storage texture, read by load alone, the others filtered. */
export const volumetricLightmapLayoutEntries = (
  first: number,
  visibility = COMPUTE,
): GPUBindGroupLayoutEntry[] => [
  computeUniformEntry(first, {}, visibility),
  computeSamplerEntry(first + 1, 'filtering', visibility),
  computeStorageTextureEntry(first + 2, 'rgba8uint', 'read-only', '3d', visibility),
  ...Array.from({ length: 8 }, (_, k) =>
    computeTextureEntry(first + 3 + k, 'float', '3d', visibility),
  ),
]

/** The bind group entries for those layout entries: `view` the block's buffer, `sampler` a
 *  bilinear one clamped to the edge. */
export const volumetricLightmapGroupEntries = (
  first: number,
  view: GPUBufferBinding,
  sampler: GPUSampler,
  textures: VolumetricLightmapTextures,
): GPUBindGroupEntry[] => [
  { binding: first, resource: view },
  { binding: first + 1, resource: sampler },
  ...textures.views.map((resource, k) => ({ binding: first + 2 + k, resource })),
]
