import test from 'node:test';
import assert from 'node:assert/strict';
import {
  entryLevel,
  entryPlace,
  packEntry,
  placeIndex,
  placeOf,
  POOL_LAYER_SIDE,
  tailOffset,
  TILE_BORDER,
  TILE_PITCH,
  tileLayout,
  tilesAt,
  TILES_PER_LAYER,
} from './textureTiles.ts';
import { texturePoolFor } from './webgpuMemoryBudgets.ts';

test('a 2048² texture has five streamed levels of 256 + 64 + 16 + 4 + 1 tiles, and its tail starts at 64', () => {
  const layout = tileLayout(2048, 2048);
  assert.equal(layout.tail, 5);
  assert.equal(layout.last, 11);
  assert.deepEqual(layout.offsets, [0, 256, 320, 336, 340]);
  assert.equal(layout.entries, 341);
  assert.deepEqual(tilesAt(2048, 2048, 4), [1, 1]);
});

test('a texture under 64 texels has no streamed level: everything is in the tail', () => {
  const layout = tileLayout(4, 3);
  assert.equal(layout.tail, 0);
  assert.equal(layout.last, 2);
  assert.deepEqual(layout.offsets, []);
  assert.equal(layout.entries, 0);
  // 100×40: level 0 exceeds 64 in width, level 1 (50×20) fits.
  assert.equal(tileLayout(100, 40).tail, 1);
  assert.deepEqual(tilesAt(100, 40, 0), [1, 1]);
  assert.throws(() => tileLayout(0, 4), /INVALID_TEXTURE_SIZE/);
  assert.throws(() => tileLayout(1 << 16, 4), /TEXTURE_TOO_LARGE/);
});

test('tail levels sit side by side on block boundaries, the 1×1 block ending in the gutter', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(tailOffset), [0, 64, 96, 112, 120, 124, 128]);
  assert.equal(TILE_BORDER + tailOffset(6) + 4, TILE_PITCH);
  assert.equal(POOL_LAYER_SIDE, 30 * TILE_PITCH);
});

test('a pool slot has a unique rank, and the table entry keeps place and level', () => {
  const place = { x: 29, y: 7, layer: 3 };
  assert.deepEqual(placeOf(placeIndex(place)), place);
  assert.equal(placeIndex({ x: 0, y: 0, layer: 1 }), TILES_PER_LAYER);
  const word = packEntry(place, 9);
  assert.equal(entryLevel(word), 9);
  assert.deepEqual(entryPlace(word), place);
  assert.ok(word > 0x7fffffff, 'the high bit says the entry is served');
});

test('the pool budget yields whole layers per atlas, and never refuses: it raises or brings back, by name', () => {
  assert.deepEqual(texturePoolFor(512 * 1024 * 1024, undefined, 4), {
    budgetBytes: 512 * 1024 * 1024,
    layers: 4,
    allocatedBytes: 8 * 66_585_600,
    clamp: null,
  });
  assert.equal(texturePoolFor(2 * 66_585_600, undefined, 4).layers, 1);
  assert.deepEqual(texturePoolFor(100_000_000, undefined, 4), {
    budgetBytes: 100_000_000,
    layers: 1,
    allocatedBytes: 2 * 66_585_600,
    clamp: 'minimum',
  });
  assert.throws(() => texturePoolFor(0, undefined, 4), /INVALID_TEXTURE_POOL_BUDGET/);
  const device = { limits: { maxTextureArrayLayers: 2 } } as unknown as GPUDevice;
  assert.deepEqual(texturePoolFor(512 * 1024 * 1024, device, 4), {
    budgetBytes: 512 * 1024 * 1024,
    layers: 2,
    allocatedBytes: 4 * 66_585_600,
    clamp: 'device-limit',
  });
});

// Behaviour: a block-compressed pool holds one byte per texel, so the same budget carries four
// times the layers — the memory saving the batch delivers, read on the pool, not estimated.
test('a block-compressed pool draws four times the layers from the same budget', () => {
  assert.deepEqual(texturePoolFor(512 * 1024 * 1024, undefined, 1), {
    budgetBytes: 512 * 1024 * 1024,
    layers: 16,
    allocatedBytes: 32 * 16_646_400,
    clamp: null,
  });
});
