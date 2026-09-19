import assert from 'node:assert/strict';
import test from 'node:test';
import { RECTS_PER_SLICE } from '../sdk-core/index.ts';
import { createGpuShadowAtlas } from './gpuShadowAtlas.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';

installGpuGlobals();

/**
 * A `GPUDevice` reduced to what `createGpuShadowAtlas` asks of it: enough to build its resources
 * without a real GPU, and a `queue.writeBuffer` that captures what it receives. None of these
 * calls needs a device: only `flushRegions` actually writes, and that is what we observe.
 */
function fakeDevice() {
  const writes: Float32Array[] = [];
  const bindGroupLayouts: unknown[] = [];
  const bindGroups: unknown[] = [];
  const device = {
    createTexture: () => ({ destroy() {}, createView: () => ({}) }),
    createBuffer: () => ({ destroy() {} }),
    createBindGroupLayout: (descriptor: unknown) => {
      bindGroupLayouts.push(descriptor);
      return {};
    },
    createPipelineLayout: () => ({}),
    createRenderPipeline: () => ({}),
    createBindGroup: (descriptor: unknown) => {
      bindGroups.push(descriptor);
      return {};
    },
    createShaderModule: () => ({}),
    queue: {
      writeBuffer(
        _buffer: unknown,
        _bufferOffset: number,
        data: Float32Array,
        dataOffset = 0,
        size?: number,
      ) {
        const end = size === undefined ? data.length : dataOffset + size;
        writes.push(data.slice(dataOffset, end));
      },
    },
  } as unknown as GPUDevice;
  return { device, writes, bindGroupLayouts, bindGroups };
}

test('the face bind group declares 96 bytes, read at the fragment as at the vertex', async () => {
  const { device, bindGroupLayouts, bindGroups } = fakeDevice();
  await createGpuShadowAtlas(device, {} as GPUBindGroupLayout);
  const entry = (bindGroupLayouts[0] as { entries: Array<Record<string, unknown>> }).entries[0];
  assert.deepEqual(entry.visibility, GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT);
  assert.equal((entry.buffer as { minBindingSize: number }).minBindingSize, 96);
  const resource = (bindGroups[0] as { entries: Array<{ resource: { size: number } }> }).entries[0]
    .resource;
  assert.equal(resource.size, 96);
});

test("a face's uniform carries the matrix, the rectangle, then the emitter's centre and radius", async () => {
  const { device, writes } = fakeDevice();
  const atlas = await createGpuShadowAtlas(device, {} as GPUBindGroupLayout);
  const matrices = new Float32Array(16);
  for (let i = 0; i < 16; i++) matrices[i] = i + 1;
  const rects = new Int32Array(RECTS_PER_SLICE);
  rects[0] = 512;
  rects[1] = 256;
  rects[2] = 1024;
  atlas.writeRegion(0, 0, 0, matrices, 0, rects, [1, 2, 3], 0.5);
  atlas.flushRegions(1);
  assert.equal(writes.length, 1);
  const entry = writes[0];
  // The first sixteen floats are the matrix as-is, never recomposed.
  assert.deepEqual(Array.from(entry.slice(0, 16)), Array.from(matrices));
  // Atlas rectangle: normalised x, y then span, and the side in texels as-is (not a pass).
  assert.deepEqual(Array.from(entry.slice(16, 20)), [512 / 4096, 256 / 4096, 1024 / 4096, 1024]);
  // Envelope centre then radius, at bytes 80 to 95 (indices 20 to 23).
  assert.deepEqual(Array.from(entry.slice(20, 24)), [1, 2, 3, 0.5]);
});

test('a light without an envelope — directional, or zero radius — carries a zero centre and radius', async () => {
  const { device, writes } = fakeDevice();
  const atlas = await createGpuShadowAtlas(device, {} as GPUBindGroupLayout);
  const matrices = new Float32Array(16);
  const rects = new Int32Array(RECTS_PER_SLICE);
  atlas.writeRegion(0, 0, 0, matrices, 0, rects, undefined, 0);
  atlas.flushRegions(1);
  assert.deepEqual(Array.from(writes[0].slice(20, 24)), [0, 0, 0, 0]);
});
