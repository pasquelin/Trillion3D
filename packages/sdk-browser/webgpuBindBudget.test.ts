import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from '../../tests/kit/gpu/globals.ts';
import { createWebgpuVisibilityShaders } from './webgpuVisibilityShaders.ts';
import { createWebgpuShadePipelines } from './webgpuVisibilityPipelines.ts';
import { createWebgpuBlendPipelines } from './webgpuBlendPipelines.ts';
import { createGpuRaster } from './gpuRaster.ts';
import { createTemporalAntialiasing } from './temporalAntialiasing.ts';

/** Fake device for layouts: it keeps only what it is asked to create. */
function recordingDevice() {
  return {
    createBuffer: ({ size, usage }: { size: number; usage: number }) => ({ size, usage }),
    createBindGroupLayout: (desc: unknown) => desc,
    createPipelineLayout: () => ({}),
    createRenderPipeline: () => ({}),
    createComputePipeline: () => ({}),
    createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
    createBindGroup: (desc: unknown) => desc,
    createSampler: () => ({}),
    queue: { writeBuffer() {} },
  } as unknown as GPUDevice;
}

// Defect this test catches: a layout gains one more storage buffer than WebGPU's guaranteed
// minimum, and the device refuses to create it — “The number of storage buffers (9) in the
// Compute stage exceeds the maximum per-stage limit (8)” — then is lost. No gate saw it: tests
// build layouts on a fake device, with no limits.
const GUARANTEED_STORAGE_BUFFERS_PER_STAGE = 8;

test('no layout exceeds the eight storage buffers guaranteed per stage', async () => {
  installGpuGlobals();
  const device = recordingDevice();
  const { visBindGroupLayout } = await createWebgpuVisibilityShaders(device, 8);
  const { shadeBindGroupLayout } = await createWebgpuShadePipelines(
    device,
    {} as GPUShaderModule,
    [],
  );
  const { blendBindGroupLayout } = await createWebgpuBlendPipelines(device, []);
  const layouts: Array<[string, unknown]> = [
    ['visibility', visBindGroupLayout],
    ['hardware resolve', shadeBindGroupLayout],
    ['transparents', blendBindGroupLayout],
    ['small triangles', await firstLayout(device, (d) => createGpuRaster(d, 4, 4, 8))],
    ['temporal antialiasing', await firstLayout(device, (d) => createTemporalAntialiasing(d, []))],
  ];
  const stages = {
    VERTEX: GPUShaderStage.VERTEX,
    FRAGMENT: GPUShaderStage.FRAGMENT,
    COMPUTE: GPUShaderStage.COMPUTE,
  };
  for (const [name, layout] of layouts) {
    const entries = (
      layout as { entries: Array<{ visibility: number; buffer?: { type?: string } }> }
    ).entries;
    for (const [stage, bit] of Object.entries(stages)) {
      const count = entries.filter(
        (entry) =>
          (entry.visibility & bit) !== 0 &&
          (entry.buffer?.type === 'storage' || entry.buffer?.type === 'read-only-storage'),
      ).length;
      assert.ok(
        count <= GUARANTEED_STORAGE_BUFFERS_PER_STAGE,
        `${name} binds ${count} storage buffers at stage ${stage}, above the ${GUARANTEED_STORAGE_BUFFERS_PER_STAGE} guaranteed`,
      );
    }
  }
});

/** First layout a constructor creates on the fake device. */
async function firstLayout(device: GPUDevice, build: (recording: GPUDevice) => unknown) {
  const layouts: unknown[] = [];
  const recording = {
    ...device,
    createBindGroupLayout: (descriptor: unknown) => {
      layouts.push(descriptor);
      return descriptor;
    },
  } as unknown as GPUDevice;
  await build(recording);
  return layouts[0];
}
