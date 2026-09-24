import assert from 'node:assert/strict';
import test from 'node:test';
import { createGpuShadowAtlas } from './atlas.ts';
import { fakeDevice, written } from '../../../../../tests/kit/gpu/fakeDevice.ts';

test('the face bind group declares 96 bytes, read at the fragment as at the vertex', async () => {
  const { device, bindGroupLayouts, bindGroups } = fakeDevice();
  await createGpuShadowAtlas(device, {} as GPUBindGroupLayout);
  const entry = (bindGroupLayouts[0] as { entries: Array<Record<string, unknown>> }).entries[0];
  assert.deepEqual(entry.visibility, GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT);
  assert.equal((entry.buffer as { minBindingSize: number }).minBindingSize, 96);
  const resource = (bindGroups[0] as unknown as { entries: Array<{ resource: { size: number } }> })
    .entries[0].resource;
  assert.equal(resource.size, 96);
});

test("a page's uniform carries its matrix, its physical page, then the emitter's centre and radius", async () => {
  const { device, writes } = fakeDevice();
  const atlas = await createGpuShadowAtlas(device, {} as GPUBindGroupLayout);
  atlas.sizePool(32);
  const matrices = new Float32Array(16);
  for (let i = 0; i < 16; i++) matrices[i] = i + 1;
  // Physical page 33 of a pool 32 pages wide: column 1, row 1.
  atlas.writePage(0, matrices, 0, 33, [1, 2, 3], 0.5);
  atlas.flushPages(1);
  assert.equal(writes.length, 1);
  const entry = written(writes[0]);
  // The first sixteen floats are the matrix as-is, never recomposed.
  assert.deepEqual(Array.from(entry.slice(0, 16)), Array.from(matrices));
  // The page's atlas rectangle: normalised x, y then span, and its side in texels.
  assert.deepEqual(Array.from(entry.slice(16, 20)), [128 / 4096, 128 / 4096, 128 / 4096, 128]);
  // Envelope centre then radius, at bytes 80 to 95 (indices 20 to 23).
  assert.deepEqual(Array.from(entry.slice(20, 24)), [1, 2, 3, 0.5]);
});

test('a light without an envelope — directional, or zero radius — carries a zero centre and radius', async () => {
  const { device, writes } = fakeDevice();
  const atlas = await createGpuShadowAtlas(device, {} as GPUBindGroupLayout);
  atlas.sizePool(32);
  atlas.writePage(0, new Float32Array(16), 0, 0, undefined, 0);
  atlas.flushPages(1);
  assert.deepEqual(Array.from(written(writes[0]).slice(20, 24)), [0, 0, 0, 0]);
});
