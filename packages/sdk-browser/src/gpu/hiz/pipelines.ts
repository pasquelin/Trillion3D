import { HIZ_SHADER, HIZ_TEST_PAGES_ENTRIES, hizBindEntries } from './shader.ts';
import { validated } from '../core/errorScope.ts';
import { shaderFailed } from '../core/shaderModule.ts';
import { oncePerDevice } from '../core/oncePerDevice.ts';
import { HIZ_UNIFORM_BYTES } from './uniforms.ts';

/**
 * The two Hi-Z kernels, build and test, compiled under one device validation scope, once a device:
 * the camera's pyramid and the shadow pages' (`../shadow/pageHiz.ts`) share them, so the static
 * layer, made at an object's first move, compiles nothing then.
 */
export const createHizPipelines = oncePerDevice((device) =>
  validated(device, async () => {
    const layout = device.createBindGroupLayout({ entries: hizBindEntries(HIZ_UNIFORM_BYTES) });
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
      pagesLayout,
      buildPipeline: stage('buildHiz'),
      testPipeline: stage('testHiz', [layout, pagesLayout]),
    };
  }),
);

/** The test's page-table group (group 1), remade only when the table changes identity (it grows):
 *  one per pyramid, never in the device's shared pipelines, where two pyramids would remake it. */
export function hizPagesGroup(device: GPUDevice, layout: GPUBindGroupLayout) {
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
export function cleanupFailedHiz(buffers: GPUBuffer[], owned?: { destroy(): void }) {
  for (const buffer of buffers)
    try {
      buffer.destroy();
    } catch {
      /* Partial setup. */
    }
  try {
    owned?.destroy();
  } catch {
    /* Partial setup. */
  }
}
