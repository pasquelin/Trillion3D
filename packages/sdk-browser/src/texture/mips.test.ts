import test from 'node:test';
import assert from 'node:assert/strict';
import { generateMaterialMips } from './mipBatch.ts';
import { mipLevelCountFor } from './tiles.ts';
import { installGpuGlobals } from '../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../tests/kit/gpu/mockGpu.ts';

/** One chain alone: a 4×4 texture under `format`, its rule and its cutoff. */
const oneChain = (
  device: GPUDevice,
  texture: GPUTexture,
  format: GPUTextureFormat,
  weighted: boolean,
  cutoff?: number,
) => generateMaterialMips(device, [{ texture, format, width: 4, height: 4, weighted, cutoff }]);

/** A four-texel-wide working texture, as tiles of a host texture cut them. */
function scratch() {
  installGpuGlobals();
  const gpu = mockGpu({ compute: true });
  const texture = gpu.device.createTexture({
    size: { width: 4, height: 4, depthOrArrayLayers: 1 },
    format: 'rgba8unorm',
    mipLevelCount: mipLevelCountFor(4, 4),
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
  }) as unknown as GPUTexture;
  return { ...gpu, texture };
}

test('reduction submits without waiting for the device and keeps a single uniform buffer', () => {
  const { device, texture, buffers, submits } = scratch();
  const before = buffers.length;
  oneChain(device, texture, 'rgba8unorm', false);
  oneChain(device, texture, 'rgba8unorm', false);
  assert.equal(submits.length, 2, 'both chains went out');
  assert.equal(buffers.length - before, 1, 'one uniform buffer for both, never destroyed');
});

test('uniforms describe one level each, at the device alignment', () => {
  const { device, texture, buffers } = scratch();
  const before = buffers.length;
  oneChain(device, texture, 'rgba8unorm', false);
  const stride = Math.max(256, device.limits.minUniformBufferOffsetAlignment ?? 256);
  assert.equal(buffers[before].size, mipLevelCountFor(4, 4) * stride);
});

// #42: the weighted rule is a pipeline of its own, built with the `weighted` constant; the plain one
// keeps it off. The compiler proves the rule's bytes (`texture_preview/tests/weighted_colour.rs`);
// which texture takes which rule is `scratch.test.ts` and `sources.test.ts`.
test('one reduction pipeline per rule, the weighted one built with its constant and reused', () => {
  const { device, texture, renderPipelines } = scratch();
  for (const rule of [true, false, true]) oneChain(device, texture, 'rgba8unorm-srgb', rule);
  assert.deepEqual(
    renderPipelines.map((pipeline) => pipeline.fragment?.constants?.weighted),
    [1, 0],
  );
});

// #748: a chain with a cutoff counts each level — level 0 first — and picks its `t` before reducing
// it, every level's block carrying the cutoff; one without counts nothing. The shaders' arithmetic
// is `coverageRule.test.ts`.
test('a chain with a cutoff counts each level before reducing it, a plain one nothing', () => {
  const { device, texture, computes, writes } = scratch();
  oneChain(device, texture, 'rgba8unorm-srgb', true, 128);
  assert.deepEqual(computes, ['count', 'count', 'choose', 'count', 'choose']);
  const stride = Math.max(256, device.limits.minUniformBufferOffsetAlignment ?? 256) / 4;
  const blocks = (at: number) => {
    const words = new Uint32Array(writes[at].bytes.buffer);
    return [0, 1, 2].map((block) => [...words.subarray(block * stride, block * stride + 7)]);
  };
  const levels = [
    [4, 4, 128, 0, 4, 4, 0],
    [4, 4, 128, 0, 4, 4, 1],
    [2, 2, 128, 0, 4, 4, 2],
  ];
  assert.deepEqual(blocks(0), levels);
  oneChain(device, texture, 'rgba8unorm-srgb', true);
  assert.equal(computes.length, 5, 'a plain chain counts nothing');
  assert.deepEqual(
    blocks(1),
    levels.map((block) => [...block.slice(0, 2), 0, ...block.slice(3)]),
  );
});

// OMB-29, #961: a batch is one uniform write and one submit; each chain encodes the passes it had
// alone, its uniform blocks after the previous chain's, a 1×1 chain nothing.
test('a batch writes its chains’ blocks once, in order, and submits them together', () => {
  const { device, texture, computes, writes, submits } = scratch();
  const offsets: number[] = [];
  const createBindGroup = device.createBindGroup.bind(device);
  device.createBindGroup = (desc) => {
    for (const { resource } of desc.entries)
      if ('offset' in resource) offsets.push(resource.offset! / 256);
    return createBindGroup(desc);
  };
  const eight = device.createTexture({ ...texture, size: [8, 8], format: 'rgba8unorm' });
  generateMaterialMips(device, [
    { texture, format: 'rgba8unorm-srgb', width: 4, height: 4, weighted: true, cutoff: 128 },
    { texture, format: 'rgba8unorm', width: 1, height: 1, weighted: false },
    { texture: eight, format: 'rgba8unorm', width: 8, height: 8, weighted: false },
  ]);
  assert.equal(submits.length, 1);
  assert.equal(writes.length, 1);
  assert.deepEqual(computes, ['count', 'count', 'choose', 'count', 'choose']);
  // Counts bind blocks 0 and 1 then 2 of the first chain; reductions 1, 2; the second chain 4–6.
  assert.deepEqual(offsets, [0, 1, 1, 2, 2, 4, 5, 6]);
  const words = new Uint32Array(writes[0].bytes.buffer);
  const block = (at: number) => [...words.subarray(at * 64, at * 64 + 7)];
  assert.deepEqual(block(2), [2, 2, 128, 0, 4, 4, 2]);
  assert.deepEqual(block(3), [8, 8, 0, 0, 8, 8, 0]);
  assert.deepEqual(block(6), [2, 2, 0, 0, 8, 8, 3]);
});

// #685: a chain's passes carry the labels the GPU timing names them by.
test('a chain’s coverage counts and reductions carry their labels', () => {
  const { device, texture, passes } = scratch();
  const counts: Array<string | undefined> = [],
    create = device.createCommandEncoder.bind(device);
  device.createCommandEncoder = (descriptor) => {
    const encoder = create(descriptor),
      begin = encoder.beginComputePass.bind(encoder);
    encoder.beginComputePass = (pass) => (counts.push(pass?.label), begin(pass));
    return encoder;
  };
  oneChain(device, texture, 'rgba8unorm-srgb', true, 128);
  assert.deepEqual(counts, Array(2).fill('Trillion3D texture coverage count'));
  assert.deepEqual(
    passes.map((pass) => pass.label),
    Array(2).fill('Trillion3D texture mips'),
  );
});
