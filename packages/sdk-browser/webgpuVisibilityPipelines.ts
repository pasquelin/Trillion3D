import { SURFACE_FORMATS } from './surfaceBuffer.ts';

async function scoped<T>(device: GPUDevice, run: () => T): Promise<T> {
  if (typeof device.pushErrorScope === 'function') device.pushErrorScope('validation');
  const value = run();
  const error = typeof device.popErrorScope === 'function' ? await device.popErrorScope() : null;
  if (error) throw error;
  return value;
}

/** Builds the visibility variants used by the selected Hi-Z or fallback path. */
export function createWebgpuVisibilityRasterPipelines(
  device: GPUDevice,
  visModule: GPUShaderModule,
  bindGroupLayout: GPUBindGroupLayout,
  hiz: boolean,
) {
  const layout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
  const depth: GPUDepthStencilState = {
    format: 'depth32float',
    depthWriteEnabled: true,
    depthCompare: 'less',
  };
  const targets: GPUColorTargetState[] = hiz
    ? [{ format: 'r32uint' }, { format: 'r32float' }]
    : [{ format: 'r32uint' }];
  const make = (
    vertex: string,
    fragment: string,
    cullMode: GPUCullMode,
    frontFace: GPUFrontFace = 'ccw',
  ) =>
    device.createRenderPipeline({
      layout,
      vertex: { module: visModule, entryPoint: vertex },
      fragment: { module: visModule, entryPoint: fragment, targets },
      primitive: { topology: 'triangle-list', cullMode, frontFace },
      depthStencil: depth,
    });
  return scoped(device, () => {
    const fragment = hiz ? 'vis_hiz_fs' : 'vis_fs';
    return {
      visPipelineBack: make('vis_vs', fragment, 'back'),
      visPipelineBackCw: make('vis_vs', fragment, 'back', 'cw'),
      visPipelineNone: make('vis_vs', fragment, 'none'),
      visPipelineFront: make('vis_vs', fragment, 'front'),
      visPipelineFrontCw: make('vis_vs', fragment, 'front', 'cw'),
      visHizRestBack: hiz ? make('vis_hiz_vs', fragment, 'back') : undefined,
      visHizRestNone: hiz ? make('vis_hiz_vs', fragment, 'none') : undefined,
      visHizRestFront: hiz ? make('vis_hiz_vs', fragment, 'front') : undefined,
      visHizRestBackCw: hiz ? make('vis_hiz_vs', fragment, 'back', 'cw') : undefined,
      visHizRestFrontCw: hiz ? make('vis_hiz_vs', fragment, 'front', 'cw') : undefined,
    };
  });
}

/** Builds the material resolve pipeline after shader compilation succeeds. */
export function createWebgpuShadePipeline(device: GPUDevice, shadeModule: GPUShaderModule) {
  const shadeBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'uint' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      {
        binding: 6,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'float', viewDimension: '2d-array' },
      },
      { binding: 7, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      {
        binding: 8,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform', minBindingSize: 256 },
      },
      {
        binding: 9,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'float', viewDimension: '2d-array' },
      },
    ],
  });
  return scoped(device, () => ({
    shadeBindGroupLayout,
    shadePipeline: device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [shadeBindGroupLayout] }),
      vertex: { module: shadeModule, entryPoint: 'shade_vs' },
      fragment: {
        module: shadeModule,
        entryPoint: 'shade_fs',
        targets: SURFACE_FORMATS.map((format) => ({ format })),
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
    }),
  }));
}
