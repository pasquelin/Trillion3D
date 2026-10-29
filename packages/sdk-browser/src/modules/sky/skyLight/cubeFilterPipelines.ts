import {
  computeBufferEntry,
  computeSamplerEntry,
  computeStorageTextureEntry,
  COMPUTE,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { FILTER_ENTRIES, FILTER_CODE } from './filterWgsl.ts'
import { IRRADIANCE_CODE, IRRADIANCE_ENTRIES } from './irradianceWgsl.ts'
import { SKY_LIGHT_CUBE_FORMAT } from './layout.ts'
import type { askedPipelines } from './askedPipelines.ts'

/**
 * THE CUBE'S MIPS, ROUGHNESS FILTER AND HARMONICS' SUMS, the passes every capture of a cube shares — the sky light's and a reflection
 * capture's: the layouts, and the four compute stages (`downsample`, `convolve`, and the harmonics summed from the filtered cube,
 * `irradiance`, or from the captured cube's mips, `capturedIrradiance`).
 */
export function cubeFilterLayouts(device: GPUDevice) {
  const layout = (entries: GPUBindGroupLayoutEntry[]) => device.createBindGroupLayout({ entries })
  return {
    filter: layout([
      computeUniformEntry(0, { hasDynamicOffset: true, minBindingSize: 16 }),
      computeTextureEntry(1, 'float', 'cube'),
      computeSamplerEntry(2, 'filtering'),
      computeStorageTextureEntry(3, SKY_LIGHT_CUBE_FORMAT, 'write-only', '2d-array'),
    ]),
    irradiance: layout([
      computeUniformEntry(0, { minBindingSize: 4 }),
      computeTextureEntry(1, 'float', 'cube'),
      computeSamplerEntry(2, 'filtering'),
      computeBufferEntry(3, 'storage', COMPUTE),
    ]),
  }
}

/** The four stages over `layouts`. */
export function cubeFilterStages(
  device: GPUDevice,
  compute: ReturnType<typeof askedPipelines>['compute'],
  layouts: ReturnType<typeof cubeFilterLayouts>,
) {
  const filterModule = device.createShaderModule({
    label: 'Trillion3D sky light filter',
    code: FILTER_CODE,
  })
  const irradianceModule = device.createShaderModule({
    label: 'Trillion3D sky light harmonics',
    code: IRRADIANCE_CODE,
  })
  return {
    downsample: compute(
      filterModule,
      layouts.filter,
      FILTER_ENTRIES.downsample,
      'Trillion3D sky light mips',
    ),
    convolve: compute(
      filterModule,
      layouts.filter,
      FILTER_ENTRIES.convolve,
      'Trillion3D sky light filter',
    ),
    irradiance: compute(
      irradianceModule,
      layouts.irradiance,
      IRRADIANCE_ENTRIES.filtered,
      'Trillion3D sky light harmonics',
    ),
    capturedIrradiance: compute(
      irradianceModule,
      layouts.irradiance,
      IRRADIANCE_ENTRIES.captured,
      'Trillion3D sky light captured harmonics',
    ),
  }
}
