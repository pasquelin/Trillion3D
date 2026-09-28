// A texture budget under the layers' floor is held tile by tile (#961); at and above the floor the
// pool is the one it always was, every place of its layers open.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TEXTURE_POOL_BUDGET, texturePoolFor } from './memoryBudgets.ts';
import { POOL_LANES, poolEncoding, type AtlasLanes } from '../../texture/blockFormats.ts';
import { tileBytes, TILES_PER_LAYER } from '../../texture/tiles.ts';

const encoding = poolEncoding('bc7');
const demand = {
  color: { lossless: 300, rgba: 5000, 'two-channel': 0 },
  data: { lossless: 0, rgba: 2000, 'two-channel': 3000 },
};
const tails = {
  color: { lossless: 10, rgba: 40, 'two-channel': 0 },
  data: { lossless: 0, rgba: 20, 'two-channel': 30 },
};
const poolFor = (bytes: number) =>
  texturePoolFor(bytes, undefined, demand, encoding.texelBytes, tails);
const every = (lanes: AtlasLanes, map: (value: number) => number) => ({
  color: Object.fromEntries(POOL_LANES.map((lane) => [lane, map(lanes.color[lane])])),
  data: Object.fromEntries(POOL_LANES.map((lane) => [lane, map(lanes.data[lane])])),
});
/** Bytes the tiles a pool may hold take, both atlases. */
const tileHeld = ({ tiles }: { tiles: AtlasLanes }) =>
  (['color', 'data'] as const).reduce(
    (sum, kind) =>
      sum +
      POOL_LANES.reduce(
        (bytes, lane) => bytes + tiles[kind][lane] * tileBytes(encoding.texelBytes(lane)),
        0,
      ),
    0,
  );

test('at the default budget and above the floor, every place of the layers is open, as before', () => {
  const byDefault = poolFor(DEFAULT_TEXTURE_POOL_BUDGET);
  assert.deepEqual(byDefault.layers, {
    color: { lossless: 1, rgba: 6, 'two-channel': 0 },
    data: { lossless: 0, rgba: 3, 'two-channel': 4 },
  });
  assert.deepEqual([byDefault.clamp, byDefault.allocatedBytes], ['scene', 285_212_672]);
  for (const pool of [byDefault, poolFor(200_000_000)])
    assert.deepEqual(
      pool.tiles,
      every(pool.layers, (layers) => layers * TILES_PER_LAYER),
    );
  assert.deepEqual(poolFor(200_000_000).layers.data, { lossless: 0, rgba: 2, 'two-channel': 3 });
});

test('under the floor, the layers stay the floor and each lane holds the tiles its share pays', () => {
  const pool = poolFor(30_000_000);
  assert.deepEqual(pool.layers, poolFor(1).layers, 'the floor of layers');
  assert.deepEqual(pool.tiles, {
    color: { lossless: 39, rgba: 654, 'two-channel': 0 },
    data: { lossless: 0, rgba: 324, 'two-channel': 486 },
  });
  assert.equal(pool.clamp, null, 'the budget is held, in tiles');
  assert.ok(tileHeld(pool) <= 30_000_000, 'the tiles held fit the budget');
  assert.ok(tileHeld(poolFor(5_000_000)) < tileHeld(pool), 'a smaller budget holds fewer tiles');
});

test('a budget under the tails and one streaming slot per lane is raised to them, by name', () => {
  const pool = poolFor(1);
  assert.equal(pool.clamp, 'minimum');
  assert.deepEqual(pool.tiles, {
    color: { lossless: 11, rgba: 41, 'two-channel': 0 },
    data: { lossless: 0, rgba: 21, 'two-channel': 31 },
  });
});
