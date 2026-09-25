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
  generateMaterialMips(device, texture, 'rgba8unorm', 4, 4);
  generateMaterialMips(device, texture, 'rgba8unorm', 4, 4);
  assert.equal(submits.length, 2, 'both chains went out');
  assert.equal(buffers.length - before, 1, 'one uniform buffer for both, never destroyed');
});

test('uniforms describe one reduced level each, at the device alignment', () => {
  const { device, texture, buffers } = scratch();
  const before = buffers.length;
  generateMaterialMips(device, texture, 'rgba8unorm', 4, 4);
  const stride = Math.max(256, device.limits.minUniformBufferOffsetAlignment ?? 256);
  assert.equal(buffers[before].size, (mipLevelCountFor(4, 4) - 1) * stride);
});

// #42: the colour atlas averages its colours weighted by alpha, so a transparent texel's colour
// no longer darkens a cutout's border; the data atlas, whose alpha is not coverage, and texels
// uploaded premultiplied, which already carry the weight, keep the plain mean. The rule is the
// compiler's (`texture_preview/tests/weighted_colour.rs` proves its bytes); here, which pipeline
// each atlas reduces with.
test('only the colour atlas in straight alpha reduces with its colours weighted by alpha', () => {
  const { device, texture } = scratch();
  const weighted: unknown[] = [];
  const create = device.createRenderPipeline.bind(device);
  Object.assign(device, {
    createRenderPipeline: (descriptor: GPURenderPipelineDescriptor) => {
      weighted.push(descriptor.fragment?.constants?.weighted);
      return create(descriptor);
    },
  });
  generateMaterialMips(device, texture, 'rgba8unorm-srgb', 4, 4);
  generateMaterialMips(device, texture, 'rgba8unorm', 4, 4);
  generateMaterialMips(device, texture, 'rgba8unorm-srgb', 4, 4, true);
  generateMaterialMips(device, texture, 'rgba8unorm-srgb', 4, 4);
  assert.deepEqual(weighted, [1, 0, 0], 'one pipeline per rule, the weighted one reused');
});
