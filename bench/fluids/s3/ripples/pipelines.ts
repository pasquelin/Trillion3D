import { createCheckedShaderModule } from '../../../../packages/sdk-browser/src/gpu/core/shaderModule.ts';
import { SPLAT_WGSL, STEP_WGSL } from './wgsl.ts';

export async function ripplePipelines(device: GPUDevice) {
  const [solve, splat] = await Promise.all([
    createCheckedShaderModule(device, STEP_WGSL, 'S3 ripple shallow water'),
    createCheckedShaderModule(device, SPLAT_WGSL, 'S3 ripple splats'),
  ]);
  const stepLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform', hasDynamicOffset: true },
      },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
      {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { access: 'write-only', format: 'rgba16float' },
      },
    ],
  });
  const splatLayout = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }],
  });
  const additive: GPUBlendComponent = { operation: 'add', srcFactor: 'one', dstFactor: 'one' };
  const [step, inject] = await Promise.all([
    device.createComputePipelineAsync({
      label: 'S3 ripple solve',
      layout: device.createPipelineLayout({ bindGroupLayouts: [stepLayout] }),
      compute: { module: solve, entryPoint: 'main' },
    }),
    device.createRenderPipelineAsync({
      label: 'S3 ripple splats',
      layout: device.createPipelineLayout({ bindGroupLayouts: [splatLayout] }),
      vertex: {
        module: splat,
        entryPoint: 'vertex',
        buffers: [
          {
            arrayStride: 16,
            stepMode: 'instance',
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }],
          },
        ],
      },
      fragment: {
        module: splat,
        entryPoint: 'fragment',
        targets: [{ format: 'rgba16float', blend: { color: additive, alpha: additive } }],
      },
      primitive: { topology: 'triangle-list' },
    }),
  ]);
  return { step, inject, stepLayout, splatLayout };
}
