import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadCompressed } from './compressedUpload.ts';
import { installGpuGlobals } from '../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../tests/kit/gpu/mockGpu.ts';

function fixture() {
  installGpuGlobals();
  const { device } = mockGpu();
  Object.defineProperty(device, 'features', { value: new Set(['texture-compression-bc']) });
  return device;
}

test('native block upload retains source bytes, mip dimensions, byte offsets and sRGB interpretation', () => {
  const device = fixture(),
    writes: unknown[] = [];
  device.queue.writeTexture = (target, data, layout, extent) => {
    writes.push({ mip: target.mipLevel, data: [...(data as Uint8Array)], layout, extent });
  };
  const storage = Uint8Array.from({ length: 48 }, (_, i) => i);
  const texture = uploadCompressed(
    device,
    {
      blockFormat: 'bc1-rgba-unorm',
      width: 5,
      height: 4,
      mipmaps: [
        { width: 5, height: 4, data: storage.subarray(8, 24) },
        { width: 2, height: 2, data: storage.subarray(24, 32) },
      ],
    },
    true,
  );
  assert.equal(texture.format, 'bc1-rgba-unorm-srgb');
  assert.equal(texture.width, 8);
  assert.deepEqual(writes, [
    {
      mip: 0,
      data: [...storage.subarray(8, 24)],
      layout: { bytesPerRow: 16, rowsPerImage: 1 },
      extent: [8, 4],
    },
    {
      mip: 1,
      data: [...storage.subarray(24, 32)],
      layout: { bytesPerRow: 8, rowsPerImage: 1 },
      extent: [4, 4],
    },
  ]);
});

test('unsupported codecs and truncated blocks are refused before a GPU allocation', () => {
  const device = fixture();
  const create = device.createTexture;
  let allocations = 0;
  device.createTexture = (...args) => {
    allocations++;
    return create(...args);
  };
  const image = {
    blockFormat: 'bc7-rgba-unorm',
    width: 4,
    height: 4,
    mipmaps: [{ width: 4, height: 4, data: new Uint8Array(15) }],
  };
  assert.throws(() => uploadCompressed(device, image, false), /TEXTURE_BLOCK_LENGTH/);
  assert.throws(
    () => uploadCompressed(device, { ...image, blockFormat: 'astc-4x4-unorm' }, false),
    /TEXTURE_BLOCK_FORMAT_UNSUPPORTED/,
  );
  assert.equal(allocations, 0);
});
