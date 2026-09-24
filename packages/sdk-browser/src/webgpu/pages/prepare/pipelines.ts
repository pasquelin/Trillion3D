import { SHADER } from './shaders.ts';
import { DEPTH_COMPARE } from '../../../camera/depthConvention.ts';
import { BLEND_EQUATIONS } from '../../../scene/materialBlending.ts';
import { pipelinesByMode } from '../../blend/stagePipelines.ts';

export function createWebgpuPagesPipelines(device: GPUDevice, uniformStride: number) {
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
  });
  const module = device.createShaderModule({ code: SHADER });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
  const fragment = {
    module,
    entryPoint: 'fs',
    targets: [{ format: 'rgba8unorm' as GPUTextureFormat }],
  };
  const depthStencil = {
    format: 'depth32float' as GPUTextureFormat,
    depthWriteEnabled: true,
    depthCompare: DEPTH_COMPARE,
  };
  const vertex = { module, entryPoint: 'vs' };
  const pipelineBack = device.createRenderPipeline({
    layout,
    vertex,
    fragment,
    primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
    depthStencil,
  });
  const pipelineBackCw = device.createRenderPipeline({
    layout,
    vertex,
    fragment,
    primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'cw' },
    depthStencil,
  });
  const pipelineNone = device.createRenderPipeline({
    layout,
    vertex,
    fragment,
    primitive: { topology: 'triangle-list', cullMode: 'none', frontFace: 'ccw' },
    depthStencil,
  });
  // One pipeline per blending mode, its equation read from the one table, in the blend pass's lazy
  // set: normal up front, as always; any other mode by the first draw that asks for it.
  const pipelineBlend = pipelinesByMode((mode) =>
    device.createRenderPipeline({
      layout,
      vertex,
      fragment: {
        ...fragment,
        targets: [{ ...fragment.targets[0], blend: BLEND_EQUATIONS[mode] }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none', frontFace: 'ccw' },
      depthStencil: { ...depthStencil, depthWriteEnabled: false },
    }),
  );
  pipelineBlend.at('normal');
  return { bindGroupLayout, pipelineBack, pipelineBackCw, pipelineNone, pipelineBlend };
}
