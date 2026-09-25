import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';
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
} from './tiles.ts';
import { texturePoolFor } from '../webgpu/residency/memoryBudgets.ts';

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

const MiB = 1024 * 1024;
const lanes = (lossless: number, rgba: number, two = 0) => ({ lossless, rgba, 'two-channel': two });
const rgba8 = () => 4;
const blocks = (lane: string) => (lane === 'lossless' ? 4 : 1);

// Behaviour: half the budget per atlas, a layer per lane that has textures, the rest by the
// bytes each lane's tiles would take — a block texel a quarter of an RGBA8 one —, a lane never
// above what its tiles need, the remainder going to the others; `scene` when every lane is
// served under the budget, `minimum` when the budget cannot give each lane its layer,
// `device-limit` when a lane exceeds the layers the device accepts; no layer for an empty lane.
test('the pool budget yields whole layers per lane, and never refuses: it raises or brings back, by name', () => {
  const demand = { color: lanes(5000, 0), data: lanes(5000, 0) };
  assert.deepEqual(texturePoolFor(512 * MiB, undefined, demand, rgba8), {
    budgetBytes: 512 * MiB,
    layers: { color: lanes(4, 0), data: lanes(4, 0) },
    allocatedBytes: 8 * 66_585_600,
    clamp: null,
  });
  assert.equal(texturePoolFor(2 * 66_585_600, undefined, demand, rgba8).layers.color.lossless, 1);
  assert.deepEqual(texturePoolFor(100_000_000, undefined, demand, rgba8), {
    budgetBytes: 100_000_000,
    layers: { color: lanes(1, 0), data: lanes(1, 0) },
    allocatedBytes: 2 * 66_585_600,
    clamp: 'minimum',
  });
  assert.throws(() => texturePoolFor(0, undefined, demand, rgba8), /INVALID_TEXTURE_POOL_BUDGET/);
  const { device } = fakeDevice({ limits: { maxTextureArrayLayers: 2 } });
  assert.deepEqual(texturePoolFor(512 * MiB, device, demand, rgba8), {
    budgetBytes: 512 * MiB,
    layers: { color: lanes(2, 0), data: lanes(2, 0) },
    allocatedBytes: 4 * 66_585_600,
    clamp: 'device-limit',
  });
  // A small scene: each lane capped at its tiles, the pool under the budget, by name.
  const small = texturePoolFor(
    512 * MiB,
    undefined,
    { color: lanes(3, 0), data: lanes(0, 901) },
    blocks,
  );
  assert.deepEqual(small.layers, { color: lanes(1, 0), data: lanes(0, 2) });
  assert.equal(small.clamp, 'scene');
});

// Behaviour: a block lane holds one byte per texel — the same budget carries four times its
// tiles — and a lane served under its share leaves the rest to the lanes still short.
test('block lanes draw four times the layers from the same bytes, and a capped lane gives the rest back', () => {
  const pool = texturePoolFor(
    512 * MiB,
    undefined,
    { color: lanes(0, 40_000), data: lanes(0, 40_000) },
    blocks,
  );
  assert.deepEqual(pool, {
    budgetBytes: 512 * MiB,
    layers: { color: lanes(0, 16), data: lanes(0, 16) },
    allocatedBytes: 32 * 16_646_400,
    clamp: null,
  });
  // 256 MiB for the colour atlas: 900 lossless tiles cap that lane at its one layer (63.5 MiB)
  // instead of the 3.5 layers a pro-rata share would give it, and the 160 MiB left after each
  // block lane's own layer split evenly between the two — five more each.
  const mixed = texturePoolFor(
    512 * MiB,
    undefined,
    { color: lanes(900, 40_000, 40_000), data: lanes(0, 0) },
    blocks,
  );
  assert.deepEqual(mixed.layers.color, lanes(1, 6, 6));
  assert.equal(mixed.clamp, null);
});
