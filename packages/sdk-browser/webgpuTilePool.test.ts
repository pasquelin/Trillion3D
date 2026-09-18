import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuTilePool } from './webgpuTilePool.ts';
import { POOL_LAYER_BYTES, TILE_BYTES, TILES_PER_LAYER } from './textureTiles.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';

installGpuGlobals();

/** Un faux appareil : il retient le descripteur de la texture qu'on lui demande. */
function fakeDevice() {
  const created: GPUTextureDescriptor[] = [];
  const device = {
    createTexture: (descriptor: GPUTextureDescriptor) => {
      created.push(descriptor);
      return {
        createView: () => ({}) as GPUTextureView,
        destroy: () => {},
      } as unknown as GPUTexture;
    },
  };
  return { device, created };
}

test('le pool alloue ses couches une fois, à la taille fixe, et compte ses tuiles', () => {
  const { device, created } = fakeDevice();
  const pool = createWebgpuTilePool(device, {
    kind: 'color',
    format: 'rgba8unorm-srgb',
    layers: 2,
  });
  assert.equal(created.length, 1);
  assert.deepEqual(created[0].size, { width: 4080, height: 4080, depthOrArrayLayers: 2 });
  assert.equal(created[0].format, 'rgba8unorm-srgb');
  assert.equal(pool.tiles, 2 * TILES_PER_LAYER);
  assert.equal(pool.bytes, 2 * POOL_LAYER_BYTES);
  assert.equal(pool.resident, 0);
  assert.throws(
    () => createWebgpuTilePool(device, { kind: 'data', format: 'rgba8unorm', layers: 0 }),
    /TEXTURE_POOL_LAYERS/,
  );
});

test('prendre, toucher, rendre : la clé suit la place, et un pool plein refuse sans jeter', () => {
  const { device } = fakeDevice();
  const pool = createWebgpuTilePool(device, { kind: 'data', format: 'rgba8unorm', layers: 1 });
  const first = pool.acquire(41, 3)!;
  assert.equal(pool.keyOf(first), 41);
  assert.deepEqual(pool.placeOf(first), { x: 0, y: 0, layer: 0 });
  assert.equal(pool.residentBytes, TILE_BYTES);
  pool.touch(first, 9);
  assert.equal(pool.lastUseOf(first), 9);
  pool.release(first);
  assert.equal(pool.resident, 0);
  assert.throws(() => pool.keyOf(first), /TEXTURE_TILE_FREE/);
  for (let i = 0; i < TILES_PER_LAYER; i++) assert.notEqual(pool.acquire(i, 1), undefined);
  assert.equal(pool.acquire(999, 1), undefined, 'plein : rien à donner, et rien de cassé');
});

test('les candidates à l’éviction sont les tuiles non épinglées vues avant l’image, la plus ancienne d’abord', () => {
  const { device } = fakeDevice();
  const pool = createWebgpuTilePool(device, { kind: 'color', format: 'rgba8unorm', layers: 1 });
  const tail = pool.acquire(1, 1, true)!;
  const old = pool.acquire(2, 2)!;
  const older = pool.acquire(3, 1)!;
  const fresh = pool.acquire(4, 7)!;
  assert.deepEqual(pool.candidates(7), [older, old]);
  assert.deepEqual(pool.candidates(8), [older, old, fresh]);
  assert.equal(pool.candidates(1).length, 0);
  pool.release(tail);
  assert.equal(pool.resident, 3);
});
