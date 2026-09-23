import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuTileAtlas } from './atlas.ts';
import { createWebgpuTilePool, type TilePoolOptions } from './pool.ts';
import { resizeTileAtlas } from './atlasResize.ts';
import { tailId, tileId } from './ids.ts';
import { tileLayout, TILE_PITCH, TILES_PER_LAYER, POOL_LAYER_SIDE } from '../../texture/tiles.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { poolEncoding } from '../../texture/blockFormats.ts';
import { textureDevice } from './textureDevice.fixture.ts';

installGpuGlobals();

const options: Omit<TilePoolOptions, 'layers'> = {
  kind: 'color',
  lane: 'lossless',
  format: 'rgba8unorm',
  texelBytes: 4,
};
const empty = { levels: [], blocks: { bc7: [], astc: [] } };
const atlasOptions = { kind: 'color' as const, encoding: poolEncoding(undefined) };
/** Layers of the lossless lane alone: what a session without a block family opens. */
const lossless = (layers: number) => ({ lossless: layers, rgba: 0, 'two-channel': 0 });
const raw = (layout: ReturnType<typeof tileLayout>) => ({
  layout,
  lane: 'lossless' as const,
  source: { kind: 'bytes' as const, tail: empty },
});

test('shrinking the pool keeps surviving layers in one copy, slot for slot, and evicts the rest', () => {
  const { gpu, copies, destroyed } = textureDevice();
  const layout = tileLayout(4096, 4096);
  const textures = [raw(layout), raw(layout)];
  const atlas = createWebgpuTileAtlas(gpu, {
    ...atlasOptions,
    layers: lossless(2),
    feedbackOffset: 0,
    textures,
  });
  atlas.pinTails({ writeTexture() {} } as never, () => {});
  // The whole of layer 0, then five tiles in layer 1: 2 queues + 903 tiles.
  for (let i = 0, placed = 0; placed < TILES_PER_LAYER + 3; i++)
    if (atlas.place({ slot: 0, level: 0, tx: i % 32, ty: Math.floor(i / 32) }, 10 + i)) placed++;
  assert.equal(atlas.pools[0].resident, TILES_PER_LAYER + 5);
  const views = atlas.views;
  const { evicted } = atlas.resize(gpu, lossless(1));
  assert.equal(atlas.pools[0].layers, 1);
  assert.notEqual(atlas.views, views, 'a new view tuple: the bind groups keyed on it rebuild');
  assert.equal(destroyed(), 1, 'the old pool is destroyed');
  assert.equal(evicted, 5, 'the five tiles of the vanished layer: nothing free for them');
  assert.equal(atlas.pools[0].resident, TILES_PER_LAYER);
  assert.deepEqual(copies, [
    { from: undefined, to: undefined, size: [POOL_LAYER_SIDE, POOL_LAYER_SIDE, 1] },
  ]);
  // Survivors have not moved: the first streamed tile is still served, slot 2.
  assert.equal(atlas.touch({ slot: 0, level: 0, tx: 0, ty: 0 }, 99), true);
  assert.equal(atlas.touch({ slot: 0, level: 0, tx: 8, ty: 28 }, 99), false, 'tile 904, evicted');
});

test('a tile from a vanished layer is moved into a free slot — queues first —, copied and re-registered', () => {
  const { gpu, copies } = textureDevice();
  const pool = createWebgpuTilePool(gpu, { ...options, layers: 2 });
  const calls: string[] = [];
  const pages = {
    setTail: (slot: number, place: { x: number; y: number; layer: number }) =>
      calls.push(`tail ${slot} → ${place.x},${place.y},${place.layer}`),
    setTile: (key: { tx: number }, place: { x: number; y: number; layer: number }) =>
      calls.push(`tile ${key.tx} → ${place.x},${place.y},${place.layer}`),
    clearTile: (key: { tx: number }) => calls.push(`clear ${key.tx}`),
  };
  // A queue in layer 1 (slot 950), a recent tile in layer 1 (951), an old one (952),
  // and a tile in layer 0 that stays where it is.
  const resident = new Map<number, number>();
  pool.adopt(5, tileId({ slot: 0, level: 0, tx: 5, ty: 0 }), 3);
  resident.set(tileId({ slot: 0, level: 0, tx: 5, ty: 0 }), 5);
  pool.adopt(950, tailId(1), 0, true);
  pool.adopt(951, tileId({ slot: 0, level: 0, tx: 7, ty: 0 }), 9);
  resident.set(tileId({ slot: 0, level: 0, tx: 7, ty: 0 }), 951);
  pool.adopt(952, tileId({ slot: 0, level: 0, tx: 6, ty: 0 }), 4);
  resident.set(tileId({ slot: 0, level: 0, tx: 6, ty: 0 }), 952);
  const result = resizeTileAtlas(gpu, { ...options, layers: 1 }, 0, pool, pages as never, resident);
  assert.equal(result.evicted, 0, 'three free places are enough');
  assert.equal(result.pool.resident, 4);
  // Queue first (slot 0), then the most looked-at (slot 1), then the old one (slot 2).
  assert.deepEqual(calls, ['tail 1 → 0,0,0', 'tile 7 → 1,0,0', 'tile 6 → 2,0,0']);
  assert.equal(copies.length, 1 + 3, 'the shared layer, then one cell per moved tile');
  assert.deepEqual(copies[1], {
    // Slot 950 = layer 1, row 1, column 20.
    from: [20 * TILE_PITCH, TILE_PITCH, 1],
    to: [0, 0, 0],
    size: [TILE_PITCH, TILE_PITCH, 1],
  });
  assert.equal(resident.get(tileId({ slot: 0, level: 0, tx: 7, ty: 0 })), 1);
  assert.equal(resident.get(tileId({ slot: 0, level: 0, tx: 5, ty: 0 })), 5, 'not moved');
});

test('growing the pool keeps the resident count, and a pool full for the view refuses before any read', () => {
  const { gpu, copies } = textureDevice();
  const layout = tileLayout(4096, 4096);
  const textures = [raw(layout)];
  const atlas = createWebgpuTileAtlas(gpu, {
    ...atlasOptions,
    layers: lossless(1),
    feedbackOffset: 0,
    textures,
  });
  atlas.pinTails({ writeTexture() {} } as never, () => {});
  for (let i = 0; i < TILES_PER_LAYER - 1; i++)
    atlas.place({ slot: 0, level: 0, tx: i % 32, ty: Math.floor(i / 32) }, 10);
  assert.equal(atlas.pools[0].resident, TILES_PER_LAYER, 'full: one queue and 899 tiles');
  // Everything was looked at on image 10: on image 11, nothing is yieldable — refuse counted, no slot taken.
  assert.equal(atlas.roomFor(0, 11), false);
  assert.equal(atlas.refused, 1);
  // On image 12, what dates from image 10 is yieldable.
  assert.equal(atlas.roomFor(0, 12), true);
  assert.equal(atlas.resize(gpu, lossless(2)).evicted, 0, 'growing evicts nothing');
  assert.equal(atlas.pools[0].resident, TILES_PER_LAYER, 'the count survives adoption');
  assert.equal(copies.length, 1);
  assert.equal(atlas.roomFor(0, 11), true, 'a free layer');
});

test('an evicted tile names its texture, so a cutout shadow that read it can follow', () => {
  const { gpu } = textureDevice();
  const layout = tileLayout(4096, 4096);
  const textures = [raw(layout), raw(layout)];
  const evicted: number[] = [];
  const atlas = createWebgpuTileAtlas(gpu, {
    ...atlasOptions,
    layers: lossless(1),
    feedbackOffset: 0,
    textures,
    onEvicted: (slot) => evicted.push(slot),
  });
  atlas.pinTails({ writeTexture() {} } as never, () => {});
  // The oldest streamed tile is of texture 1; texture 0 fills the rest of the layer.
  atlas.place({ slot: 1, level: 0, tx: 0, ty: 0 }, 10);
  for (let i = 0, placed = 0; placed < TILES_PER_LAYER - 3; i++)
    if (atlas.place({ slot: 0, level: 0, tx: i % 32, ty: Math.floor(i / 32) }, 11)) placed++;
  assert.equal(atlas.pools[0].resident, TILES_PER_LAYER);
  assert.deepEqual(evicted, [], 'a full pool evicts nothing until a tile asks for a place');
  atlas.place({ slot: 0, level: 1, tx: 0, ty: 0 }, 40);
  assert.deepEqual(evicted, [1], 'the least looked-at tile gave its place: texture 1');
});
