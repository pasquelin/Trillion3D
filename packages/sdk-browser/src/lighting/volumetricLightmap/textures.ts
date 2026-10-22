import {
  computeSamplerEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
  COMPUTE,
} from '../../gpu/core/computeBindings.ts'
import { EngineError } from '../../../../sdk-core/src/contracts/cache.ts'
import type {
  VolumetricLightmapData,
  VolumetricLightmapFormat,
  VolumetricLightmapLayer,
} from '../../../../sdk-core/src/lighting/volumetricLightmapFile.ts'

/**
 * The volumetric lightmap's textures: ten 3D textures, one a layer of the file, in the order of
 * the bindings of `sampleWgsl.ts` — the indirection volume, the ambient, the six coefficient
 * layers, the sky's bent normal, the sun's shadowing. A lightmap that is absent, or has no bent
 * normal, is bound as a black texture of one texel, as the sampling then reads black. A program that
 * reads the lightmap spends nine of its sixteen sampled textures and one read-only storage texture.
 */

/** The bindings a program spends on the lightmap: its view block, its sampler, its ten textures. */
export const VOLUMETRIC_LIGHTMAP_BINDINGS = 12

/** The ten textures and their views, made once for a lightmap. */
export interface VolumetricLightmapTextures {
  readonly views: readonly GPUTextureView[]
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
  data.directionalShadowing,
]

const BYTES: Record<VolumetricLightmapFormat, number> = {
  rgba8uint: 4,
  rg11b10ufloat: 4,
  rgba8unorm: 4,
  r8unorm: 1,
}
const FORMATS: readonly VolumetricLightmapFormat[] = [
  'rgba8uint',
  'rg11b10ufloat',
  ...Array<VolumetricLightmapFormat>(7).fill('rgba8unorm'),
  'r8unorm',
]

/** The texture of one layer of `size`, filled; a texel of black where `layer` is `undefined`. */
function layerTexture(
  device: GPUDevice,
  format: VolumetricLightmapFormat,
  layer: VolumetricLightmapLayer | undefined,
  size: readonly [number, number, number],
  label: string,
) {
  const [width, height, depthOrArrayLayers] = layer ? size : [1, 1, 1]
  const texture = device.createTexture({
    label,
    dimension: '3d',
    size: { width, height, depthOrArrayLayers },
    format,
    usage:
      (format === 'rgba8uint' ? GPUTextureUsage.STORAGE_BINDING : GPUTextureUsage.TEXTURE_BINDING) |
      GPUTextureUsage.COPY_DST,
  })
  if (layer)
    device.queue.writeTexture(
      { texture },
      layer.bytes as Uint8Array<ArrayBuffer>,
      { bytesPerRow: width * BYTES[format], rowsPerImage: height },
      { width, height, depthOrArrayLayers },
    )
  return texture
}

/** The textures of `data`, or the black ones where there is none. A volume past the device's 3D
 *  limit throws `INVALID_CACHE`; a refusal of the budget leaves nothing made. */
export function createVolumetricLightmapTextures(
  device: GPUDevice,
  data: VolumetricLightmapData | undefined,
  label = 'Trillion3D volumetric lightmap',
): VolumetricLightmapTextures {
  const limit = device.limits.maxTextureDimension3D
  if (data && [...data.indirectionSize, ...data.atlasSize].some((side) => side > limit))
    throw new EngineError(
      'INVALID_CACHE',
      `the volumetric lightmap exceeds the ${limit}-texel 3D limit`,
      {},
    )
  const layers = data ? layersOf(data) : FORMATS.map(() => undefined)
  const made: GPUTexture[] = []
  try {
    for (const [k, layer] of layers.entries()) {
      const size = k === 0 ? data?.indirectionSize : data?.atlasSize
      made.push(layerTexture(device, FORMATS[k], layer, size ?? [1, 1, 1], `${label} ${k}`))
    }
  } catch (error) {
    for (const texture of made) texture.destroy()
    throw error
  }
  return {
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
  ...Array.from({ length: 9 }, (_, k) =>
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
