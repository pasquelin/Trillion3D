import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuVisibilityShaders } from '../visibility/shaders.ts';
import { createWebgpuShadePipelines } from '../visibility/pipelines.ts';
import { createWebgpuBlendPipelines } from '../blend/pipelines.ts';
import { createGpuRaster } from '../../gpu/raster/raster.ts';
import { createTemporalAntialiasing } from '../../taa/temporalAntialiasing.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';

// Defect this test catches: a layout gains one more storage buffer than WebGPU's guaranteed
// minimum, and the device refuses to create it — “The number of storage buffers (9) in the
// Compute stage exceeds the maximum per-stage limit (8)” — then is lost. No gate saw it: tests
// build layouts on a fake device, with no limits.
const GUARANTEED_STORAGE_BUFFERS_PER_STAGE = 8;

test('no layout exceeds the eight storage buffers guaranteed per stage', async () => {
  const { device } = fakeDevice();
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
    ['small triangles', await firstLayout((d) => createGpuRaster(d, 4, 4, 8))],
    ['temporal antialiasing', await firstLayout((d) => createTemporalAntialiasing(d, []))],
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

/** First layout a constructor creates on a fake device of its own. */
async function firstLayout(build: (device: GPUDevice) => unknown) {
  const { device, bindGroupLayouts } = fakeDevice();
  await build(device);
  return bindGroupLayouts[0];
}
