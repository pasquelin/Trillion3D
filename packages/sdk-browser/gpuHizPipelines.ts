import { HIZ_SHADER } from './gpuHizShader.ts';
import { dropValidation, openValidation, validationFailed } from './gpuErrorScope.ts';
import { shaderFailed } from './gpuShaderModule.ts';

/** Compile the three Hi-Z kernels under one device validation scope. */
export async function createHizPipelines(device: GPUDevice, uniformBytes: number) {
  openValidation(device);
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType: 'unfilterable-float' },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: uniformBytes },
      },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const module = device.createShaderModule({ code: HIZ_SHADER });
  if (await shaderFailed(device, module)) return undefined;
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const copyPipeline = device.createComputePipeline({
    layout: pipelineLayout,
    compute: { module, entryPoint: 'copyDepth' },
  });
  const reducePipeline = device.createComputePipeline({
    layout: pipelineLayout,
    compute: { module, entryPoint: 'reduceHiz' },
  });
  const testPipeline = device.createComputePipeline({
    layout: pipelineLayout,
    compute: { module, entryPoint: 'testHiz' },
  });
  if (await validationFailed(device)) return undefined;
  return { layout, copyPipeline, reducePipeline, testPipeline };
}

/** A partial GPU setup must release every resource it has acquired. */
export async function cleanupFailedHiz(
  device: GPUDevice,
  buffers: GPUBuffer[],
  level0?: GPUTexture,
  pyramid?: GPUBuffer,
) {
  await dropValidation(device);
  for (const buffer of buffers)
    try {
      buffer.destroy();
    } catch {
      /* Partial setup. */
    }
  try {
    level0?.destroy();
  } catch {
    /* Partial setup. */
  }
  try {
    pyramid?.destroy();
  } catch {
    /* Partial setup. */
  }
}
