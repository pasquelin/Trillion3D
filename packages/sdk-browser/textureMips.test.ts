import test from 'node:test';
import assert from 'node:assert/strict';
import { generateMaterialMips, mipLevelCountFor } from './textureMips.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { mockGpu } from './webgpuPagesMockGpu.ts';

/** Une texture de travail de quatre texels de côté, comme les tuiles d'une texture de l'hôte en découpent. */
function scratch() {
  installGpuGlobals();
  const gpu = mockGpu();
  const texture = gpu.device.createTexture({
    size: { width: 4, height: 4, depthOrArrayLayers: 1 },
    format: 'rgba8unorm',
    mipLevelCount: mipLevelCountFor(4, 4),
  }) as unknown as GPUTexture;
  return { ...gpu, texture };
}

test('la réduction soumet sans attendre l’appareil et garde un seul tampon d’uniformes', () => {
  const { device, texture, buffers, submits } = scratch();
  const before = buffers.length;
  generateMaterialMips(device, texture, 'rgba8unorm', 4, 4);
  generateMaterialMips(device, texture, 'rgba8unorm', 4, 4);
  assert.equal(submits.length, 2, 'les deux chaînes sont parties');
  assert.equal(
    buffers.length - before,
    1,
    'un seul tampon d’uniformes pour les deux, jamais détruit',
  );
});

test('les uniformes décrivent un niveau réduit chacun, à l’alignement de l’appareil', () => {
  const { device, texture, buffers } = scratch();
  const before = buffers.length;
  generateMaterialMips(device, texture, 'rgba8unorm', 4, 4);
  const stride = Math.max(256, device.limits.minUniformBufferOffsetAlignment ?? 256);
  assert.equal(buffers[before].size, (mipLevelCountFor(4, 4) - 1) * stride);
});
