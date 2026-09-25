import test from 'node:test';
import assert from 'node:assert/strict';
import { generateMaterialMips, mipLevelCountFor } from './mips.ts';
import { installGpuGlobals } from '../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../tests/kit/gpu/mockGpu.ts';

/** A four-texel-wide working texture, as tiles of a host texture cut them. */
function scratch() {
  installGpuGlobals();
  const gpu = mockGpu();
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
