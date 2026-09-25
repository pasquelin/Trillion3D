// The visibility uniform (`VIS_UNIFORM_BYTES`). Defect this test catches: a group binds it at
// another size than the struct the shaders declare — the real device then refuses the dispatch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuVisibilityShaders } from '../visibility/shaders.ts';
import { smallBindEntries, visBindEntries } from './bindEntries.ts';
import { SMALL_BINDINGS, VIS_BINDINGS, VIS_UNIFORM_BYTES } from './bindLayout.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import type { WebgpuTileStreamer } from '../tile/streamer.ts';

const buffer = {} as GPUBuffer;
const textures = {
  color: { views: [{}, {}, {}], pages: { buffer } },
} as unknown as WebgpuTileStreamer;
const sizeAt = (entries: GPUBindGroupEntry[], binding: number) =>
  (entries.find((entry) => entry.binding === binding)?.resource as GPUBufferBinding).size;

test('every group that binds the visibility uniform spans the whole struct', () => {
  const shared = { textures, sampler: {} as GPUSampler, uniform: buffer };
  const vis = visBindEntries({
    ...shared,
    cache: buffer,
    position: buffer,
    pageTable: buffer,
    flags: buffer,
    uniformOffset: 256,
    uv: buffer,
    instances: buffer,
    slotOffsets: buffer,
  });
  const small = smallBindEntries({
    ...shared,
    indices: buffer,
    positions: buffer,
    pages: buffer,
    hizFlags: buffer,
    uvs: buffer,
    work: buffer,
    selectionMask: buffer,
  });
  assert.equal(sizeAt(vis, VIS_BINDINGS.uniform), VIS_UNIFORM_BYTES);
  assert.equal(sizeAt(small, SMALL_BINDINGS.uniform), VIS_UNIFORM_BYTES);
});

test('only the vertex stage reads the visibility uniform, at the size of its struct', async () => {
  const { device } = fakeDevice();
  const { visBindGroupLayout } = await createWebgpuVisibilityShaders(device, 8);
  const entry = (
    visBindGroupLayout as unknown as { entries: GPUBindGroupLayoutEntry[] }
  ).entries.find((candidate) => candidate.binding === VIS_BINDINGS.uniform)!;
  // No fragment of the pass reads it since the cutout stipple left (#55).
  assert.equal(entry.visibility, GPUShaderStage.VERTEX);
  assert.equal(entry.buffer?.minBindingSize, VIS_UNIFORM_BYTES);
});
