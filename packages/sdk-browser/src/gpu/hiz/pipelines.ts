import { HIZ_SHADER, HIZ_TEST_PAGES_ENTRIES, hizBindEntries } from './shader.ts';
import { validated } from '../core/errorScope.ts';
import { shaderFailed } from '../core/shaderModule.ts';

/** Compile the three Hi-Z kernels under one device validation scope. */
export function createHizPipelines(device: GPUDevice, uniformBytes: number) {
  return validated(device, async () => {
    const layout = device.createBindGroupLayout({ entries: hizBindEntries(uniformBytes) });
    const module = device.createShaderModule({ code: HIZ_SHADER });
    if (await shaderFailed(module)) return undefined;
    const pagesLayout = device.createBindGroupLayout({ entries: HIZ_TEST_PAGES_ENTRIES });
    const stage = (entryPoint: string, groups = [layout]) =>
      device.createComputePipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: groups }),
        compute: { module, entryPoint },
      });
    return {
      layout,
      pagesGroup: hizPagesGroup(device, pagesLayout),
      copyPipeline: stage('copyDepth'),
      reducePipeline: stage('reduceHiz'),
      testPipeline: stage('testHiz', [layout, pagesLayout]),
    };
  });
}

/** The test's page-table group (group 1), remade only when the table changes identity (it grows). */
function hizPagesGroup(device: GPUDevice, layout: GPUBindGroupLayout) {
  let bound: GPUBuffer | undefined, group: GPUBindGroup | undefined;
  return (pages: GPUBuffer) => {
    if (pages !== bound || !group)
      group = device.createBindGroup({
        layout,
        entries: [{ binding: 0, resource: { buffer: pages } }],
      });
    bound = pages;
    return group;
  };
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
