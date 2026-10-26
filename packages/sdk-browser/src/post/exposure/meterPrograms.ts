import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { preparedComputeStage } from '../../gpu/core/computeStages.ts'
import {
  computeBufferEntry,
  computeSamplerEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { filterPrograms, type FilterPairs } from '../filters/filterPrograms.ts'
import { BASIC_SETUP_WGSL } from './basicWgsl.ts'
import { ADAPT_WGSL, MEASURE_WGSL } from './meterWgsl.ts'

/** The layouts of the meter's groups: the measure's — the image (the grid's last level for the
 *  basic one), the uniform, the measure's buffer, the metering mask and the sampler it is read
 *  through —, the basic method's setup and the update's. */
function meterLayouts(device: GPUDevice) {
  return {
    measureLayout: device.createBindGroupLayout({
      label: 'Trillion3D exposure measure',
      entries: [
        computeTextureEntry(0, 'unfilterable-float'),
        computeUniformEntry(1),
        computeBufferEntry(2, 'storage'),
        computeTextureEntry(3, 'float'),
        computeSamplerEntry(4, 'filtering'),
      ],
    }),
    setupLayout: device.createBindGroupLayout({
      label: 'Trillion3D exposure basic setup',
      entries: [
        computeTextureEntry(0, 'unfilterable-float'),
        computeStorageTextureEntry(1, HDR_FORMAT),
        computeUniformEntry(2),
      ],
    }),
    adaptLayout: device.createBindGroupLayout({
      label: 'Trillion3D exposure adapt',
      entries: [
        computeUniformEntry(0),
        computeBufferEntry(1, 'read-only-storage'),
        computeBufferEntry(2, 'storage'),
        computeUniformEntry(3),
      ],
    }),
  }
}

/**
 * The meter's programs once a device, compiled off the thread: the histogram of the image or the
 * basic method's setup and measure — the measure two entries of one module with the histogram's,
 * over one layout —, then the exposure they ask (`meterWgsl.ts`, `basicWgsl.ts`). They are asked
 * as an image that needs them enters the scene (`askExposure`), those of its method alone, and the
 * frames are held on them, so no image is drawn at an exposure it never measured; a compile the
 * device refuses leaves the image at the exposure it had.
 */
export const meterPrograms = oncePerDevice((device: GPUDevice) => {
  const layouts = meterLayouts(device)
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
  const setupLabel = 'Trillion3D exposure basic setup'
  const adaptLabel = 'Trillion3D exposure adapt'
  const measureModule = device.createShaderModule({ label: measureLabel, code: MEASURE_WGSL })
  const setupModule = device.createShaderModule({ label: setupLabel, code: BASIC_SETUP_WGSL })
  const adaptModule = device.createShaderModule({ label: adaptLabel, code: ADAPT_WGSL })
  return {
    ...layouts,
    measure: stage(measureLabel, measureModule, layouts.measureLayout, 'measure'),
    basic: stage(
      'Trillion3D exposure basic measure',
      measureModule,
      layouts.measureLayout,
      'measureBasic',
    ),
    setup: stage(setupLabel, setupModule, layouts.setupLayout, 'basicSetup'),
    adapt: stage(adaptLabel, adaptModule, layouts.adaptLayout, 'adapt'),
  }
})

/** The meter's programs (`meterPrograms`). */
export type MeterPrograms = ReturnType<typeof meterPrograms>

/** The programs the meter runs for the method `basic` or not: the measure, with the basic
 *  method's setup before it, and the update. */
const programsOf = (programs: ReturnType<typeof meterPrograms>, basic: boolean) =>
  basic ? [programs.setup, programs.basic, programs.adapt] : [programs.measure, programs.adapt]

/** The filters the scene's chain is drawn with, which either method reads: the half-size image the
 *  histogram reads and the levels under it the basic method's grid is drawn from
 *  (`../filters/sceneChain.ts`, `../filters/downsampleChain.ts`). */
const SCENE_FILTERS: FilterPairs = [
  ['halve', HDR_FORMAT],
  ['halveWide', HDR_FORMAT],
]

/** Asks the meter's programs of `device` for the method `basic` or not off the frame, the frames
 *  held until they landed (`../../frame/loop/framePipelines.ts`). */
export function askExposurePrograms(device: GPUDevice, basic: boolean) {
  for (const program of programsOf(meterPrograms(device), basic)) program.ask()
  filterPrograms(device).ask(SCENE_FILTERS)
}

/** Whether the programs the meter runs for the method `basic` or not are compiled. */
export const exposureProgramsReady = (device: GPUDevice, basic: boolean) =>
  programsOf(meterPrograms(device), basic).every((program) => program.ready) &&
  filterPrograms(device).ready(SCENE_FILTERS)
