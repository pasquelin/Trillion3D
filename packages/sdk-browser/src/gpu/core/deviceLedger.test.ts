import test from 'node:test';
import assert from 'node:assert/strict';
import { gpuDeviceLedgerOf, installGpuDeviceLedger, textureBytesOf } from './deviceLedger.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';

test('a texture is counted over all its levels, layers and format', () => {
  const rgba = textureBytesOf({
    size: { width: 2048, height: 2048, depthOrArrayLayers: 3 },
    format: 'rgba8unorm',
    mipLevelCount: 12,
    usage: 0,
  });
  // 2048² × 4 bytes × (1 + 1/4 + … + 1/4¹¹) × 3 layers.
  let perLayer = 0;
  for (let l = 0; l < 12; l++) perLayer += (2048 >> l) ** 2 * 4;
  assert.equal(rgba, perLayer * 3);
  assert.equal(textureBytesOf({ size: [64, 32], format: 'depth32float', usage: 0 }), 64 * 32 * 4);
  // A BC7 block is sixteen bytes for sixteen texels: one byte per texel, rounded to the block.
  assert.equal(textureBytesOf({ size: [6, 6], format: 'bc7-rgba-unorm', usage: 0 }), 4 * 16);
  // A volume also divides its depth at each level; an array does not.
  assert.equal(
    textureBytesOf({
      size: [4, 4, 4],
      format: 'r8unorm',
      mipLevelCount: 2,
      dimension: '3d',
      usage: 0,
    }),
    64 + 8,
  );
  assert.equal(
    textureBytesOf({ size: [4, 4, 4], format: 'r8unorm', mipLevelCount: 2, usage: 0 }),
    64 + 16,
  );
  assert.equal(textureBytesOf({ size: [1, 1], format: 'r8snorm', usage: 0 }), null);
});

test('the ledger sees each allocation, returns it on destroy and installs once', () => {
  const { device, destroyed } = fakeDevice();
  const ledger = installGpuDeviceLedger(device);
  assert.equal(installGpuDeviceLedger(device), ledger);
  assert.equal(gpuDeviceLedgerOf(device), ledger);
  const buffer = device.createBuffer({ label: 'Trillion3D pages', size: 1000, usage: 0 });
  device.createBuffer({ label: 'Trillion3D pages', size: 24, usage: 0 });
  const texture = device.createTexture({
    label: 'Trillion3D display color',
    size: [16, 16],
    format: 'rgba8unorm',
    usage: 0,
  });
  device.createBuffer({ size: 8, usage: 0 });
  let snapshot = ledger.snapshot();
  assert.equal(snapshot.bytes, 1024 + 1024 + 8);
  assert.deepEqual(Object.keys(snapshot.byLabel), [
    'Trillion3D pages',
    'Trillion3D display color',
    'unlabeled',
  ]);
  assert.equal(snapshot.live, 4);
  assert.equal(snapshot.unknownFormats, 0);
  buffer.destroy();
  texture.destroy();
  texture.destroy();
  assert.deepEqual(
    destroyed.map((resource) => resource.label ?? ''),
    ['Trillion3D pages', 'Trillion3D display color', 'Trillion3D display color'],
  );
  snapshot = ledger.snapshot();
  assert.equal(snapshot.bytes, 24 + 8);
  assert.equal(snapshot.live, 2);
});

test('a format outside the table counts zero bytes and declares itself, never an estimate', () => {
  const { device } = fakeDevice();
  const ledger = installGpuDeviceLedger(device);
  device.createTexture({ size: [8, 8], format: 'r8snorm', usage: 0 });
  assert.deepEqual(ledger.snapshot(), {
    bytes: 0,
    byLabel: { unlabeled: 0 },
    unknownFormats: 1,
    live: 1,
  });
  assert.equal(gpuDeviceLedgerOf(undefined), undefined);
});
