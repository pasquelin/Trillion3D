import { BLEND_SHADER } from './webgpuPagesShaders.ts';
import { UNIFORM_STRIDE } from './webgpuBlendUniforms.ts';
import type { BlendGpuItem } from './webgpuBlendState.ts';

/** Builds the forward-material pipelines for transparent draws. */
export async function createWebgpuBlendPipelines(device: GPUDevice, items: BlendGpuItem[]) {
  const blendBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      {
        binding: 3,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: UNIFORM_STRIDE },
      },
      {
        binding: 4,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'float', viewDimension: '2d-array' },
      },
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      {
        binding: 6,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'float', viewDimension: '2d-array' },
      },
      { binding: 7, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 8, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 9, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 10, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      {
        binding: 11,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'float', viewDimension: '2d-array' },
      },
      { binding: 12, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    ],
  });
  const blendModule = device.createShaderModule({ code: BLEND_SHADER });
  const makeBlend = (cullMode: GPUCullMode) => {
    const descriptor: GPURenderPipelineDescriptor = {
      layout: device.createPipelineLayout({ bindGroupLayouts: [blendBindGroupLayout] }),
      vertex: { module: blendModule, entryPoint: 'vs' },
      fragment: {
        module: blendModule,
        entryPoint: 'fs',
        targets: [
          {
            format: 'rgba16float' as GPUTextureFormat,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode, frontFace: 'ccw' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'less' },
    };
    return device.createRenderPipelineAsync
      ? device.createRenderPipelineAsync(descriptor)
      : Promise.resolve(device.createRenderPipeline(descriptor));
  };
  for (const item of items) item.group = undefined;
  const pipelineBlendTextured = await makeBlend('none'),
    pipelineBlendFront = await makeBlend('front'),
    pipelineBlendBack = await makeBlend('back');
  return { blendBindGroupLayout, pipelineBlendTextured, pipelineBlendFront, pipelineBlendBack };
}
