import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gpuDeviceLedgerOf,
  installGpuDeviceLedger,
  textureBytesOf,
  type LedgerDevice,
} from './gpuDeviceLedger.ts';

/** Un faux appareil : ses ressources ne font que se laisser détruire. */
function fakeDevice() {
  const destroyed: string[] = [];
  const device = {
    createTexture: (d: GPUTextureDescriptor) =>
      ({ destroy: () => destroyed.push(d.label ?? '') }) as unknown as GPUTexture,
    createBuffer: (d: GPUBufferDescriptor) =>
      ({ destroy: () => destroyed.push(d.label ?? '') }) as unknown as GPUBuffer,
  } satisfies LedgerDevice;
  return { device, destroyed };
}

test('une texture se compte sur tous ses niveaux, ses couches et son format', () => {
  const rgba = textureBytesOf({
    size: { width: 2048, height: 2048, depthOrArrayLayers: 3 },
    format: 'rgba8unorm',
    mipLevelCount: 12,
    usage: 0,
  });
  // 2048² × 4 octets × (1 + 1/4 + … + 1/4¹¹) × 3 couches.
  let perLayer = 0;
  for (let l = 0; l < 12; l++) perLayer += (2048 >> l) ** 2 * 4;
  assert.equal(rgba, perLayer * 3);
  assert.equal(textureBytesOf({ size: [64, 32], format: 'depth32float', usage: 0 }), 64 * 32 * 4);
  // Un bloc BC7 vaut seize octets pour seize texels : un octet par texel, arrondi au bloc.
  assert.equal(textureBytesOf({ size: [6, 6], format: 'bc7-rgba-unorm', usage: 0 }), 4 * 16);
  // Un volume divise aussi sa profondeur à chaque niveau ; un tableau, non.
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

test('le registre voit chaque allocation, la rend à la destruction et se pose une seule fois', () => {
  const { device, destroyed } = fakeDevice();
  const ledger = installGpuDeviceLedger(device);
  assert.equal(installGpuDeviceLedger(device), ledger);
  assert.equal(gpuDeviceLedgerOf(device), ledger);
  const buffer = device.createBuffer({ label: 'WG pages', size: 1000, usage: 0 });
  device.createBuffer({ label: 'WG pages', size: 24, usage: 0 });
  const texture = device.createTexture({
    label: 'WG display color',
    size: [16, 16],
    format: 'rgba8unorm',
    usage: 0,
  });
  device.createBuffer({ size: 8, usage: 0 });
  let snapshot = ledger.snapshot();
  assert.equal(snapshot.bytes, 1024 + 1024 + 8);
  assert.deepEqual(Object.keys(snapshot.byLabel), [
    'WG pages',
    'WG display color',
    'sans étiquette',
  ]);
  assert.equal(snapshot.live, 4);
  assert.equal(snapshot.unknownFormats, 0);
  buffer.destroy();
  texture.destroy();
  texture.destroy();
  assert.deepEqual(destroyed, ['WG pages', 'WG display color', 'WG display color']);
  snapshot = ledger.snapshot();
  assert.equal(snapshot.bytes, 24 + 8);
  assert.equal(snapshot.live, 2);
});

test('un format hors table compte zéro octet et se déclare, jamais une estimation', () => {
  const { device } = fakeDevice();
  const ledger = installGpuDeviceLedger(device);
  device.createTexture({ size: [8, 8], format: 'r8snorm', usage: 0 });
  assert.deepEqual(ledger.snapshot(), {
    bytes: 0,
    byLabel: { 'sans étiquette': 0 },
    unknownFormats: 1,
    live: 1,
  });
  assert.equal(gpuDeviceLedgerOf(undefined), undefined);
});
