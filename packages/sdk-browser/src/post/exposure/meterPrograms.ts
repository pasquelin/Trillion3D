import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { preparedComputeStage } from '../../gpu/core/computeStages.ts'
import {
  computeBufferEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { ADAPT_WGSL, MEASURE_WGSL } from './meterWgsl.ts'

/**
 * The meter's two programs once a device, compiled off the thread: the histogram of the image,
 * then the exposure it asks (`meterWgsl.ts`). They are asked as an image that needs them enters
 * the scene (`askExposure`), and the frames are held on them, so no image is drawn at an exposure
 * it never measured; a compile the device refuses leaves the image at the exposure it had.
 */
export const meterPrograms = oncePerDevice((device: GPUDevice) => {
  const measureLayout = device.createBindGroupLayout({
    label: 'Trillion3D exposure measure',
    entries: [
      computeTextureEntry(0, 'unfilterable-float'),
      computeUniformEntry(1),
      computeBufferEntry(2, 'storage'),
    ],
  })
  const adaptLayout = device.createBindGroupLayout({
    label: 'Trillion3D exposure adapt',
    entries: [
      computeUniformEntry(0),
      computeBufferEntry(1, 'read-only-storage'),
      computeBufferEntry(2, 'storage'),
    ],
  })
  const stage = (
    label: string,
    module: GPUShaderModule,
    layout: GPUBindGroupLayout,
    entryPoint: string,
  ) =>
    preparedComputeStage(
      device,
      device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      module,
      entryPoint,
      undefined,
      label,
    )
  const measureLabel = 'Trillion3D exposure measure'
  const adaptLabel = 'Trillion3D exposure adapt'
  return {
    measureLayout,
    adaptLayout,
    measure: stage(
      measureLabel,
      device.createShaderModule({ label: measureLabel, code: MEASURE_WGSL }),
      measureLayout,
      'measure',
    ),
    adapt: stage(
      adaptLabel,
      device.createShaderModule({ label: adaptLabel, code: ADAPT_WGSL }),
      adaptLayout,
      'adapt',
    ),
  }
})

/** Asks the meter's programs of `device` off the frame, the frames held until they landed
 *  (`../../frame/loop/framePipelines.ts`). */
export function askExposurePrograms(device: GPUDevice) {
  const { measure, adapt } = meterPrograms(device)
  measure.ask()
  adapt.ask()
}
