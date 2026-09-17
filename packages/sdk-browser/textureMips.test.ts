import test from 'node:test';
import assert from 'node:assert/strict';
import { generateMaterialMips, mipLevelCountFor } from './textureMips.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { mockGpu } from './webgpuPagesMockGpu.ts';

/** Une classe d'atlas de quatre couches, comme la pompe en régénère une à chaque texture achevée. */
function atlasClass() {
  installGpuGlobals();
  const gpu = mockGpu();
  const texture = gpu.device.createTexture({
    size: { width: 4, height: 4, depthOrArrayLayers: 4 },
    format: 'rgba8unorm',
  }) as unknown as GPUTexture;
  const scales = Array.from({ length: 4 }, () => [1, 1] as [number, number]);
  return { ...gpu, texture, scales };
}

test('la réduction soumet sans attendre l’appareil et garde un seul tampon d’uniformes', () => {
  const { device, texture, scales, buffers, submits } = atlasClass();
  const before = buffers.length;
  generateMaterialMips(device, texture, 'rgba8unorm', 4, 4, scales, [2]);
  generateMaterialMips(device, texture, 'rgba8unorm', 4, 4, scales, [3]);
  assert.equal(submits.length, 2, 'les deux régénérations sont parties');
  assert.equal(
    buffers.length - before,
    1,
    'un seul tampon d’uniformes pour les deux, jamais détruit',
  );
});

test('les uniformes ne décrivent que les couches régénérées, pas toute la classe', () => {
  const { device, texture, scales, buffers } = atlasClass();
  const before = buffers.length;
  generateMaterialMips(device, texture, 'rgba8unorm', 4, 4, scales, [2]);
  const stride = Math.max(256, device.limits.minUniformBufferOffsetAlignment ?? 256);
  assert.equal(
    buffers[before].size,
    (mipLevelCountFor(4, 4) - 1) * stride,
    'une couche, pas quatre',
  );
});
