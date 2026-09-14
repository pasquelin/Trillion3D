import { SHADER } from './webgpuPagesShaders.ts';

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
    depthCompare: 'less' as GPUCompareFunction,
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
  const pipelineBlend = device.createRenderPipeline({
    layout,
    vertex,
    fragment: {
      module,
      entryPoint: 'fs',
      targets: [
        {
          format: 'rgba8unorm',
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        },
      ],
    },
    primitive: { topology: 'triangle-list', cullMode: 'none', frontFace: 'ccw' },
    depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'less' },
  });
  return { bindGroupLayout, pipelineBack, pipelineBackCw, pipelineNone, pipelineBlend };
}
