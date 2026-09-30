import { REFLECTION_SOURCE_VIEW_BYTES } from './source.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { textureBytesOf } from '../gpu/core/textureBytes.ts';
import { createScreenReflection } from './gpu.ts';
import { reflectionConeAllocation } from './conePyramid.ts';

function extraBytes(width: number, height: number) {
  let texels = 0,
    reductions = 0;
  while (width > 1 || height > 1) {
    width = Math.max(1, Math.floor(width / 2));
    height = Math.max(1, Math.floor(height / 2));
    texels += width * height;
    reductions++;
  }
  return texels * 16 + reductions * 2 * 256;
}

test('forward cone admission equals live descriptors at 4K and odd sizes without counting source twice', () => {
  for (const [width, height] of [
    [3840, 2160],
    [7, 5],
    [9, 1],
    [64, 32],
  ]) {
    const gpu = fakeDevice({ limits: { minUniformBufferOffsetAlignment: 256 } });
    const reflection = createScreenReflection(
      gpu.device,
      width,
      height,
      {} as GPUTextureView,
      true,
      false,
      true,
    );
    const bytes =
      gpu.textures.reduce((sum, texture) => sum + textureBytesOf(texture)!, 0) +
      gpu.buffers.reduce((sum, buffer) => sum + buffer.size, 0);
    assert.equal(
      bytes - width * height * 8 - 80 - REFLECTION_SOURCE_VIEW_BYTES,
      extraBytes(width, height),
    );
    assert.equal(
      reflectionConeAllocation(width, height, gpu.device.limits).bytes,
      extraBytes(width, height),
    );
    assert.equal(reflection.history, undefined, 'no opaque receiver history for forward filtering');
    reflection.dispose();
    assert.equal(gpu.destroyed.length, gpu.textures.length + gpu.buffers.length);
    assert.equal(new Set(gpu.destroyed).size, gpu.destroyed.length);
  }
});

test('a failed depth chain releases its radiance chain and both owned textures', () => {
  let extents = 0;
  const gpu = fakeDevice({
    limits: { minUniformBufferOffsetAlignment: 256 },
    refuse: (descriptor) =>
      descriptor.label === 'Trillion3D radiance mip extents' && ++extents === 2
        ? 'throw'
        : undefined,
  });
  assert.throws(
    () => createScreenReflection(gpu.device, 64, 32, {} as GPUTextureView, true, false, true),
    /NO_MEMORY/,
  );
  assert.equal(gpu.destroyed.length, 3);
  assert.equal(new Set(gpu.destroyed).size, 3);
});
