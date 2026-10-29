import {
  computeStorageEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { layoutStagesOf } from '../../../gpu/core/computeStages.ts'
import { oncePerDeviceKey } from '../../../gpu/core/oncePerDevice.ts'
import { AVSM_COMBINE_WGSL } from './combineVolumetricShadowMapsWgsl.ts'
import { AVSM_COMPRESS_WGSL } from './compressVolumetricShadowMapWgsl.ts'
import { AVSM_CONVERT_BEER_WGSL } from './convertBeerToAvsmWgsl.ts'
import { avsmConvertToBeerProgram } from './convertAvsmToBeerWgsl.ts'
import { avsmRenderProgram } from './renderVolumetricShadowMapWgsl.ts'

/** The texture format of a Beer shadow map the conversion back writes: 16 bits a channel or 32. */
export type BeerFormat = 'rgba16float' | 'rgba32float'

/**
 * THE PIPELINES OF THE VOLUMETRIC SHADOW MAP'S PASSES, prepared once a device and a Beer format off the frame: the Beer map's conversion to
 * a volumetric shadow map and back, the compression of the lists and the combination of two. Each has its own bind-group layout.
 */
export const volumetricShadowPassesOf = oncePerDeviceKey(
  (device: GPUDevice, format: BeerFormat) => {
    const label = 'Trillion3D heterogeneous volume shadow map'
    const stage = layoutStagesOf(device, label)
    const params = computeUniformEntry(0)
    return {
      convertBeer: stage(
        'convert from Beer',
        device.createShaderModule({ label, code: AVSM_CONVERT_BEER_WGSL }),
        'convertBeerLawShadowMapToVolumetricShadowMap',
        [
          params,
          computeTextureEntry(1, 'unfilterable-float'),
          computeStorageEntry(2, true),
          computeStorageEntry(3, true),
          computeStorageEntry(4, true),
        ],
      ),
      convertToBeer: stage(
        'convert to Beer',
        device.createShaderModule({ label, code: avsmConvertToBeerProgram(format) }),
        'convertVolumetricShadowMapToBeerLawShadowMap',
        [params, computeStorageEntry(1, false), computeStorageTextureEntry(2, format)],
      ),
      compress: stage(
        'compress',
        device.createShaderModule({ label, code: AVSM_COMPRESS_WGSL }),
        'compressVolumetricShadowMap',
        [
          params,
          computeStorageEntry(1, false),
          computeStorageEntry(2, true),
          computeStorageEntry(3, true),
          computeStorageEntry(4, true),
        ],
      ),
      render: stage(
        'render',
        device.createShaderModule({ label, code: avsmRenderProgram(format) }),
        'renderVolumetricShadowMap',
        [
          params,
          computeUniformEntry(1),
          computeStorageEntry(2, false),
          computeStorageEntry(3, false),
          computeStorageEntry(4, false),
          computeStorageEntry(5, false),
          computeStorageEntry(6, false),
          computeStorageEntry(7, true),
          computeStorageTextureEntry(8, format),
          computeTextureEntry(9, 'float'),
        ],
      ),
      combine: stage(
        'combine',
        device.createShaderModule({ label, code: AVSM_COMBINE_WGSL }),
        'combineVolumetricShadowMaps',
        [
          params,
          computeStorageEntry(1, false),
          computeStorageEntry(2, false),
          computeStorageEntry(3, true),
        ],
      ),
    }
  },
)

export type VolumetricShadowPasses = ReturnType<typeof volumetricShadowPassesOf>
