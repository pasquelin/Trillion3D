import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import {
  COMPUTE,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { preparedComputeStage } from '../../../gpu/core/computeStages.ts'
import { pipelineLayoutOf } from '../../deferred/fullscreen.ts'
import { SCREEN_SPACE_BINDINGS as B } from '../rayCastWgsl.ts'
import { inputEntries } from '../pipelines.ts'
import { DENOISE_BINDINGS as D, DENOISE_PARAMS_BYTES } from './denoiseView.ts'
import { denoiseSpatialWgsl } from './spatialWgsl.ts'
import { denoiseAccumulationWgsl } from './accumulationWgsl.ts'
import { keepWgsl } from './keepWgsl.ts'
import type { DenoiseSignal } from './signalWgsl.ts'

/** The formats the denoiser's textures take: the colour, and the pair (weight and confusion, or missed share and weight) in two floats. */
export const DENOISE_FORMAT_A = 'rgba16float' as const
export const DENOISE_FORMAT_B = 'rg32float' as const

/** The bind group layouts of the denoiser's passes, once a device: the spatial pass (the signal in, the signal out), the accumulation (and the history, the last
 *  image's surface), the keeping of the surface. */
export const denoiseLayouts = oncePerDevice((device: GPUDevice) => {
  const make = (entries: GPUBindGroupLayoutEntry[], label: string) =>
    device.createBindGroupLayout({ label: `Trillion3D screen space denoise ${label}`, entries })
  const spatial = [
    ...inputEntries(COMPUTE),
    computeUniformEntry(D.params, { minBindingSize: DENOISE_PARAMS_BYTES }),
    computeTextureEntry(D.sourceA, 'unfilterable-float'),
    computeTextureEntry(D.sourceB, 'unfilterable-float'),
    computeStorageTextureEntry(B.out, DENOISE_FORMAT_A),
    computeStorageTextureEntry(B.outSecond, DENOISE_FORMAT_B),
  ]
  return {
    spatial: make(spatial, 'spatial'),
    accumulation: make(
      [
        ...spatial,
        computeTextureEntry(D.historyA, 'unfilterable-float'),
        computeTextureEntry(D.historyB, 'unfilterable-float'),
        computeTextureEntry(D.prevDepth, 'unfilterable-float'),
        computeTextureEntry(D.prevNormals, 'unfilterable-float'),
      ],
      'accumulation',
    ),
    keep: make(
      [
        ...inputEntries(COMPUTE),
        computeStorageTextureEntry(D.keepDepth, 'r32float'),
        computeStorageTextureEntry(D.keepNormals, 'rgba16float'),
      ],
      'keep',
    ),
  }
})

const stageOf = (
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  module: GPUShaderModule,
  entry: string,
) => preparedComputeStage(device, pipelineLayoutOf(device, [layout]), module, entry)

/** The spatial pass of `signal` reading the trace's output (`input`, the reconstruction) or a pass's (`history`, a pre-convolution), once a device and a case. */
const spatialStages = oncePerDevice((device: GPUDevice) => {
  const made = new Map<string, ReturnType<typeof stageOf>>()
  return (signal: DenoiseSignal, layout: 'input' | 'history') => {
    const key = `${signal}:${layout}`
    let stage = made.get(key)
    if (!stage) {
      const module = device.createShaderModule({
        label: 'Trillion3D screen space denoise spatial',
        code: denoiseSpatialWgsl(signal, layout),
      })
      stage = stageOf(device, denoiseLayouts(device).spatial, module, 'denoiseCompute')
      made.set(key, stage)
    }
    return stage
  }
})
export const denoiseSpatialPipeline = (
  device: GPUDevice,
  signal: DenoiseSignal,
  layout: 'input' | 'history',
) => spatialStages(device)(signal, layout)

const accumulationStages = oncePerDevice((device: GPUDevice) => {
  const made = new Map<DenoiseSignal, ReturnType<typeof stageOf>>()
  return (signal: DenoiseSignal) => {
    let stage = made.get(signal)
    if (!stage) {
      const module = device.createShaderModule({
        label: 'Trillion3D screen space denoise accumulation',
        code: denoiseAccumulationWgsl(signal),
      })
      stage = stageOf(device, denoiseLayouts(device).accumulation, module, 'denoiseCompute')
      made.set(signal, stage)
    }
    return stage
  }
})
export const denoiseAccumulationPipeline = (device: GPUDevice, signal: DenoiseSignal) =>
  accumulationStages(device)(signal)

export const denoiseKeepPipeline = oncePerDevice((device: GPUDevice) =>
  stageOf(
    device,
    denoiseLayouts(device).keep,
    device.createShaderModule({ label: 'Trillion3D screen space denoise keep', code: keepWgsl() }),
    'keepCompute',
  ),
)
