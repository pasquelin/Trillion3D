import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import {
  fullscreenDescriptor,
  pipelineLayoutOf,
  preparedComputePipeline,
  preparedPipeline,
  type PreparedPipeline,
} from '../deferred/fullscreen.ts'
import { DN_MOTION_ENTRIES, DN_MOTION_PROGRAMS } from './denoiseMotionWgsl.ts'
import { DN_PREPASS_ENTRIES, DN_PREPASS_PROGRAMS } from './denoisePrepassWgsl.ts'
import { DN_RESOLVE_ENTRIES, DN_RESOLVE_PROGRAMS } from './denoiseResolveWgsl.ts'
import { DN_SPATIAL_ENTRY, DN_SPATIAL_WGSL } from './denoiseSpatialWgsl.ts'
import { DN_VISUALIZE_ENTRIES, DN_VISUALIZE_PROGRAMS } from './denoiseVisualizeWgsl.ts'

const F32 = 'rgba32float' as const

/** One compute kernel of the denoiser: its layout (the parameters at 0, then what the kernel reads and writes) and its pipeline, prepared off the frame. */
export interface DenoiseKernel {
  readonly layout: GPUBindGroupLayout
  readonly pipeline: PreparedPipeline<GPUComputePipeline>
}

type Entry = GPUBindGroupLayoutEntry
const tex = (binding: number, dimension: GPUTextureViewDimension = '2d') =>
  computeTextureEntry(binding, 'unfilterable-float', dimension)
const out = (binding: number, dimension: GPUTextureViewDimension = '2d') =>
  computeStorageTextureEntry(binding, F32, 'write-only', dimension)

/** Every pipeline of the denoiser on a device. */
export interface DenoisePipelines {
  readonly mip: DenoiseKernel
  readonly align: DenoiseKernel
  readonly blur: DenoiseKernel
  readonly merge: DenoiseKernel
  readonly subtract: DenoiseKernel
  readonly reject: DenoiseKernel
  readonly resolve: DenoiseKernel
  readonly fusion: DenoiseKernel
  readonly prepass: DenoiseKernel
  readonly texture: DenoiseKernel
  readonly spatial: DenoiseKernel
  readonly visualLayout: GPUBindGroupLayout
  readonly motionView: PreparedPipeline<GPURenderPipeline>
  readonly warpView: PreparedPipeline<GPURenderPipeline>
  readonly all: readonly PreparedPipeline<unknown>[]
}

function kernel(
  device: GPUDevice,
  label: string,
  module: GPUShaderModule,
  entryPoint: string,
  entries: readonly Entry[],
): DenoiseKernel {
  const layout = device.createBindGroupLayout({
    label: `Trillion3D path tracer denoiser ${label}`,
    entries: [computeUniformEntry(0), ...entries],
  })
  return {
    layout,
    pipeline: preparedComputePipeline(device, {
      layout: pipelineLayoutOf(device, [layout]),
      compute: { module, entryPoint },
    }),
  }
}

/** The denoiser's pipelines on `device`: made once, each prepared off the frame. */
export const denoisePipelinesOf = oncePerDevice((device: GPUDevice): DenoisePipelines => {
  const motion = DN_MOTION_ENTRIES
  const resolve = DN_RESOLVE_ENTRIES
  const mip = kernel(
    device,
    'pyramid',
    device.createShaderModule({
      label: 'Trillion3D path tracer denoiser pyramid',
      code: DN_MOTION_PROGRAMS.mip,
    }),
    motion.mip,
    [tex(1), out(2)],
  )
  const align = kernel(
    device,
    'align',
    device.createShaderModule({
      label: 'Trillion3D path tracer denoiser align',
      code: DN_MOTION_PROGRAMS.align,
    }),
    motion.align,
    [tex(1), tex(2), tex(3), out(4, '2d-array')],
  )
  const blur = kernel(
    device,
    'blur',
    device.createShaderModule({
      label: 'Trillion3D path tracer denoiser blur',
      code: DN_MOTION_PROGRAMS.blur,
    }),
    motion.blur,
    [tex(1), out(2)],
  )
  const merge = kernel(
    device,
    'merge',
    device.createShaderModule({
      label: 'Trillion3D path tracer denoiser merge',
      code: DN_MOTION_PROGRAMS.merge,
    }),
    motion.merge,
    [tex(1), tex(2, '2d-array'), out(3)],
  )
  const subtract = kernel(
    device,
    'subtract',
    device.createShaderModule({
      label: 'Trillion3D path tracer denoiser subtract',
      code: DN_MOTION_PROGRAMS.subtract,
    }),
    motion.subtract,
    [tex(1), tex(2), out(3)],
  )
  const reject = kernel(
    device,
    'rejection',
    device.createShaderModule({
      label: 'Trillion3D path tracer denoiser rejection',
      code: DN_RESOLVE_PROGRAMS.reject,
    }),
    resolve.reject,
    [tex(1), tex(2), tex(3), out(4)],
  )
  const resolved = kernel(
    device,
    'resolve',
    device.createShaderModule({
      label: 'Trillion3D path tracer denoiser resolve',
      code: DN_RESOLVE_PROGRAMS.resolve,
    }),
    resolve.resolve,
    [tex(1), tex(2), tex(3), tex(4), tex(5), out(6)],
  )
  const fusion = kernel(
    device,
    'fusion',
    device.createShaderModule({
      label: 'Trillion3D path tracer denoiser fusion',
      code: DN_RESOLVE_PROGRAMS.fusion,
    }),
    resolve.fusion,
    [
      computeBufferEntry(1, 'read-only-storage'),
      computeBufferEntry(2, 'read-only-storage'),
      out(3),
      out(4),
    ],
  )
  const prepass = kernel(
    device,
    'prepass',
    device.createShaderModule({
      label: 'Trillion3D path tracer denoiser prepass',
      code: DN_PREPASS_PROGRAMS.prepass,
    }),
    DN_PREPASS_ENTRIES.prepass,
    [tex(1), tex(2), tex(3), computeBufferEntry(4, 'storage')],
  )
  const texture = kernel(
    device,
    'variance image',
    device.createShaderModule({
      label: 'Trillion3D path tracer denoiser variance image',
      code: DN_PREPASS_PROGRAMS.texture,
    }),
    DN_PREPASS_ENTRIES.texture,
    [computeBufferEntry(1, 'read-only-storage'), out(2)],
  )
  const spatial = kernel(
    device,
    'spatial',
    device.createShaderModule({
      label: 'Trillion3D path tracer denoiser spatial',
      code: DN_SPATIAL_WGSL,
    }),
    DN_SPATIAL_ENTRY,
    [tex(1), tex(2), tex(3), tex(4), out(5)],
  )
  const FRAGMENT = GPUShaderStage.FRAGMENT
  const visualLayout = device.createBindGroupLayout({
    label: 'Trillion3D path tracer denoiser views',
    entries: [
      computeUniformEntry(0, {}, FRAGMENT),
      computeTextureEntry(1, 'unfilterable-float', '2d', FRAGMENT),
      computeTextureEntry(2, 'unfilterable-float', '2d', FRAGMENT),
    ],
  })
  const view = (entry: string, module: GPUShaderModule) =>
    preparedPipeline(
      device,
      fullscreenDescriptor(device, module, visualLayout, entry, [{ format: HDR_FORMAT }]),
    )
  const motionView = view(
    DN_VISUALIZE_ENTRIES.motion,
    device.createShaderModule({
      label: 'Trillion3D path tracer denoiser motion view',
      code: DN_VISUALIZE_PROGRAMS.motion,
    }),
  )
  const warpView = view(
    DN_VISUALIZE_ENTRIES.warp,
    device.createShaderModule({
      label: 'Trillion3D path tracer denoiser warp view',
      code: DN_VISUALIZE_PROGRAMS.warp,
    }),
  )
  const kernels = [
    mip,
    align,
    blur,
    merge,
    subtract,
    reject,
    resolved,
    fusion,
    prepass,
    texture,
    spatial,
  ]
  return {
    mip,
    align,
    blur,
    merge,
    subtract,
    reject,
    resolve: resolved,
    fusion,
    prepass,
    texture,
    spatial,
    visualLayout,
    motionView,
    warpView,
    all: [...kernels.map((k) => k.pipeline), motionView, warpView],
  }
})
