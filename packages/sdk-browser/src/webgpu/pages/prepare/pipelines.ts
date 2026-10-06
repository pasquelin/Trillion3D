import { SHADER } from './shaders.ts'
import { DEPTH_COMPARE } from '../../../camera/depthConvention.ts'
import { BLEND_EQUATIONS } from '../../../scene/materialBlending.ts'
import { pipelinesByMode } from '../../blend/stagePipelines.ts'
import { buildRenderPipeline } from '../../../lighting/deferred/fullscreen.ts'
import type { Blending } from '../../../../../sdk-core/src/world/constants/index.ts'

/** The fallback pass's pipelines, its three opaque culls compiled together off the thread. */
export async function createWebgpuPagesPipelines(device: GPUDevice, uniformStride: number) {
  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      {
        binding: 2,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: uniformStride },
      },
    ],
  })
  const module = device.createShaderModule({ code: SHADER })
  const layout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] })
  const fragment = {
    module,
    entryPoint: 'fs',
    targets: [{ format: 'rgba8unorm' as GPUTextureFormat }],
  }
  const depthStencil = {
    format: 'depth32float' as GPUTextureFormat,
    depthWriteEnabled: true,
    depthCompare: DEPTH_COMPARE,
  }
  const vertex = { module, entryPoint: 'vs' }
  const opaque = (cullMode: GPUCullMode, frontFace: GPUFrontFace) =>
    buildRenderPipeline(device, {
      layout,
      vertex,
      fragment,
      primitive: { topology: 'triangle-list', cullMode, frontFace },
      depthStencil,
    })
  const [pipelineBack, pipelineBackCw, pipelineNone] = await Promise.all([
    opaque('back', 'ccw'),
    opaque('back', 'cw'),
    opaque('none', 'ccw'),
  ])
  // One pipeline per blending mode, its equation read from the one table, in the blend pass's lazy
  // set: the modes the scene declares — normal among them once one exists — off the frame, once its
  // blend items exist (`precompile`); any other mode by the first draw that asks for it.
  const blendDescriptor = (mode: Blending): GPURenderPipelineDescriptor => ({
    layout,
    vertex,
    fragment: {
      ...fragment,
      targets: [{ ...fragment.targets[0], blend: BLEND_EQUATIONS[mode] }],
    },
    primitive: { topology: 'triangle-list', cullMode: 'none', frontFace: 'ccw' },
    depthStencil: { ...depthStencil, depthWriteEnabled: false },
  })
  const pipelineBlend = pipelinesByMode(device, (mode) => [blendDescriptor(mode)])
  return { bindGroupLayout, pipelineBack, pipelineBackCw, pipelineNone, pipelineBlend }
}
