// #55: the visibility uniform grew to carry the cutout stipple word. Defect this test catches: a
// group binds it at its old size, or the layout hides it from the fragment that reads the word —
// the real device then refuses the pipeline or the dispatch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { createWebgpuVisibilityShaders } from '../visibility/shaders.ts';
import { smallBindEntries, visBindEntries } from './bindEntries.ts';
import { SMALL_BINDINGS, VIS_BINDINGS, VIS_UNIFORM_BYTES } from './bindLayout.ts';
import { layoutCreators } from './layoutDevice.fixture.ts';
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

test('the fragment of the visibility pass sees the uniform it reads the stipple from', async () => {
  installGpuGlobals();
  const device = layoutCreators() as unknown as GPUDevice;
  const { visBindGroupLayout } = await createWebgpuVisibilityShaders(device, 8);
  const entry = (
    visBindGroupLayout as unknown as { entries: GPUBindGroupLayoutEntry[] }
  ).entries.find((candidate) => candidate.binding === VIS_BINDINGS.uniform)!;
  assert.ok(entry.visibility & GPUShaderStage.FRAGMENT);
  assert.equal(entry.buffer?.minBindingSize, VIS_UNIFORM_BYTES);
});
