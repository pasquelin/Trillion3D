import {
  COMPUTE,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { skyLightReadLayoutEntries } from '../../modules/sky/skyLight/read.ts'
import { PT_SKY_BINDINGS, PT_SKY_BUILD_WGSL } from '../pathTracing/buildPrograms.ts'
import {
  PT_SKY_COMPENSATE_ENTRY,
  PT_SKY_MIP_ENTRY,
  PT_SKY_PREPARE_ENTRY,
} from '../pathTracing/skyWgsl.ts'
import {
  pipelineLayoutOf,
  preparedComputePipeline,
  type PreparedPipeline,
} from '../deferred/fullscreen.ts'
import { SKY_TABLE_PDF_FORMAT, SKY_TABLE_TEXTURE_FORMAT } from './skyTable.ts'

/** The compute pipelines of the table's build by name, prepared off the frame. */
export type SkyTableStageSet = Readonly<
  Record<'prepare' | 'mip' | 'compensate', PreparedPipeline<GPUComputePipeline>>
>

/**
 * THE PASSES THAT BUILD THE SKY'S TABLE (`ptSkyPrepare`, `ptSkyMip`, `ptSkyCompensate`) and the layouts of their two groups (the sky light's read, then the table's
 * parameters, the table and the density levels), once a device.
 */
export const skyTableStagesOf = oncePerDevice((device: GPUDevice) => {
  const sky = device.createBindGroupLayout({
    label: 'Trillion3D sky table sky light',
    entries: skyLightReadLayoutEntries(PT_SKY_BINDINGS, COMPUTE),
  })
  const build = device.createBindGroupLayout({
    label: 'Trillion3D sky table build',
    entries: [
      computeUniformEntry(0),
      computeStorageTextureEntry(1, SKY_TABLE_TEXTURE_FORMAT),
      computeStorageTextureEntry(2, SKY_TABLE_PDF_FORMAT, 'read-write'),
      computeTextureEntry(3, 'unfilterable-float'),
    ],
  })
  const module = device.createShaderModule({
    label: 'Trillion3D sky table',
    code: PT_SKY_BUILD_WGSL,
  })
  const stage = (entryPoint: string) =>
    preparedComputePipeline(device, {
      layout: pipelineLayoutOf(device, [sky, build]),
      compute: { module, entryPoint },
    })
  return {
    layouts: [sky, build] as const,
    stages: {
      prepare: stage(PT_SKY_PREPARE_ENTRY),
      mip: stage(PT_SKY_MIP_ENTRY),
      compensate: stage(PT_SKY_COMPENSATE_ENTRY),
    } satisfies SkyTableStageSet,
  }
})
