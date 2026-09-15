import { BLEND_SHADER } from './webgpuPagesShaders.ts';
import { UNIFORM_STRIDE } from './webgpuBlendUniforms.ts';
import type { BlendGpuItem } from './webgpuBlendState.ts';
import { BLEND_BINDINGS, atlasLayoutEntry, readOnly } from './webgpuBindLayout.ts';
import { VOLUME_SIZE } from './webgpuTransmission.ts';

/** Builds the forward-material pipelines for transparent draws. */
export async function createWebgpuBlendPipelines(device: GPUDevice, items: BlendGpuItem[]) {
  const b = BLEND_BINDINGS;
  const blendBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: b.indices, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      { binding: b.positions, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      { binding: b.uvs, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      {
        binding: b.uniform,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: UNIFORM_STRIDE },
      },
      ...b.maps.map((binding) => atlasLayoutEntry(binding)),
      { binding: b.sampler, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ...b.dataMaps.map((binding) => atlasLayoutEntry(binding)),
      { binding: b.normals, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      { binding: b.scales, visibility: GPUShaderStage.FRAGMENT, buffer: readOnly },
      { binding: b.directLights, visibility: GPUShaderStage.FRAGMENT, buffer: readOnly },
      { binding: b.clusterDiagnostic, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      { binding: b.colorSlots, visibility: GPUShaderStage.FRAGMENT, buffer: readOnly },
      { binding: b.dataSlots, visibility: GPUShaderStage.FRAGMENT, buffer: readOnly },
      { binding: b.clusterIds, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      { binding: b.clusterSpans, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      { binding: b.shadowSlices, visibility: GPUShaderStage.FRAGMENT, buffer: readOnly },
      {
        binding: b.shadowAtlas,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'depth' },
      },
      {
        binding: b.shadowSampler,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: 'comparison' },
      },
      { binding: b.bounceGrid, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: b.probes, visibility: GPUShaderStage.FRAGMENT, buffer: readOnly },
      { binding: b.tileLights, visibility: GPUShaderStage.FRAGMENT, buffer: readOnly },
      {
        binding: b.volume,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: VOLUME_SIZE },
      },
      {
        binding: b.backdrop,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'unfilterable-float', viewDimension: '2d' },
      },
      {
        binding: b.backdropDepth,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'depth', viewDimension: '2d' },
      },
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
