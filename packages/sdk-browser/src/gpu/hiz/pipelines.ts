import { HIZ_SHADER, hizBindEntries } from './shader.ts';
import { validated } from '../core/errorScope.ts';
import { shaderFailed } from '../core/shaderModule.ts';

/** Compile the three Hi-Z kernels under one device validation scope. */
export function createHizPipelines(device: GPUDevice, uniformBytes: number) {
  return validated(device, async () => {
    const layout = device.createBindGroupLayout({ entries: hizBindEntries(uniformBytes) });
    const module = device.createShaderModule({ code: HIZ_SHADER });
    if (await shaderFailed(module)) return undefined;
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const stage = (entryPoint: string) =>
      device.createComputePipeline({ layout: pipelineLayout, compute: { module, entryPoint } });
    return {
      layout,
      copyPipeline: stage('copyDepth'),
      reducePipeline: stage('reduceHiz'),
      testPipeline: stage('testHiz'),
    };
  });
}

/** A partial GPU setup must release every resource it has acquired. */
export function cleanupFailedHiz(buffers: GPUBuffer[], level0?: GPUTexture, pyramid?: GPUBuffer) {
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
