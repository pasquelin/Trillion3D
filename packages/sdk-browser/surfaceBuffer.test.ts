import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSurfaceSize, frameTargetBytes, createSurfaceBuffer } from './surfaceBuffer.ts';

test('surface budgets reject invalid dimensions, device limits and excess allocation before creation', () => {
  const device = { limits: { maxTextureDimension2D: 1024 } } as GPUDevice;
  assert.throws(() => checkSurfaceSize(device, 0, 10, 10000), /INVALID_SURFACE_SIZE/);
  assert.throws(() => checkSurfaceSize(device, 1025, 1, 100000), /SURFACE_DEVICE_LIMIT/);
  assert.throws(() => checkSurfaceSize(device, 100, 100, 279999), /SURFACE_BUDGET/);
  assert.equal(checkSurfaceSize(device, 100, 100, 280000), 280000);
  assert.equal(
    frameTargetBytes(3, 3, true),
    9 * 48 + 9 * 4 + (9 + 4 + 1) * 8,
    'odd Hi-Z levels must reserve ceil dimensions',
  );
});

test('a partial surface allocation failure destroys all textures already allocated', () => {
  Object.assign(globalThis, {
    GPUTextureUsage: { RENDER_ATTACHMENT: 16, TEXTURE_BINDING: 4, COPY_SRC: 1, COPY_DST: 2 },
  });
  let created = 0,
    destroyed = 0;
  const device = {
    limits: { maxTextureDimension2D: 1024 },
    createTexture() {
      if (++created === 3) throw new Error('NO_MEMORY');
      return {
        destroy() {
          destroyed++;
        },
      };
    },
  } as unknown as GPUDevice;
  assert.throws(() => createSurfaceBuffer(device, 16, 16, 10000), /NO_MEMORY/);
  assert.equal(destroyed, 2);
});
