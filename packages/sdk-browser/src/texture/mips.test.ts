import test from 'node:test';
import assert from 'node:assert/strict';
import { generateMaterialMips } from './mips.ts';
import { mipLevelCountFor } from './tiles.ts';
import { installGpuGlobals } from '../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../tests/kit/gpu/mockGpu.ts';

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
  generateMaterialMips(device, texture, 'rgba8unorm', 4, 4, false);
  generateMaterialMips(device, texture, 'rgba8unorm', 4, 4, false);
  assert.equal(submits.length, 2, 'both chains went out');
  assert.equal(buffers.length - before, 1, 'one uniform buffer for both, never destroyed');
});

test('uniforms describe one reduced level each, at the device alignment', () => {
  const { device, texture, buffers } = scratch();
  const before = buffers.length;
  generateMaterialMips(device, texture, 'rgba8unorm', 4, 4, false);
  const stride = Math.max(256, device.limits.minUniformBufferOffsetAlignment ?? 256);
  assert.equal(buffers[before].size, (mipLevelCountFor(4, 4) - 1) * stride);
});

// #42: the weighted rule is a pipeline of its own, built with the `weighted` constant; the plain one
// keeps it off. The compiler proves the rule's bytes (`texture_preview/tests/weighted_colour.rs`);
// which texture takes which rule is `scratch.test.ts` and `sources.test.ts`.
test('one reduction pipeline per rule, the weighted one built with its constant and reused', () => {
  const { device, texture, renderPipelines } = scratch();
  for (const rule of [true, false, true])
    generateMaterialMips(device, texture, 'rgba8unorm-srgb', 4, 4, rule);
  assert.deepEqual(
    renderPipelines.map((pipeline) => pipeline.fragment?.constants?.weighted),
    [1, 0],
  );
});

// #748: a chain with a cutoff counts each level — level 0 first — and picks its `t` before reducing
// it, every level's block carrying the cutoff and level 0's own block last; one without counts
// nothing, its blocks as before. The shaders' arithmetic is `coverageRule.test.ts`.
test('a chain with a cutoff counts each level before reducing it, a plain one nothing', () => {
  const { device, texture, computes, writes } = scratch();
  generateMaterialMips(device, texture, 'rgba8unorm-srgb', 4, 4, true, 128);
  assert.deepEqual(computes, ['count', 'count', 'choose', 'count', 'choose']);
  const stride = Math.max(256, device.limits.minUniformBufferOffsetAlignment ?? 256) / 4;
  const blocks = (at: number) => {
    const words = new Uint32Array(writes[at].bytes.buffer);
    return [0, 1, 2].map((block) => [...words.subarray(block * stride, block * stride + 7)]);
  };
  const levels = [
    [4, 4, 128, 0, 4, 4, 1],
    [2, 2, 128, 0, 4, 4, 2],
    [4, 4, 128, 0, 4, 4, 0],
  ];
  assert.deepEqual(blocks(0), levels);
  generateMaterialMips(device, texture, 'rgba8unorm-srgb', 4, 4, true);
  assert.equal(computes.length, 5, 'a plain chain counts nothing');
  assert.equal(writes[1].bytes.length, 2 * stride * 4, 'two blocks, one per reduced level');
});
