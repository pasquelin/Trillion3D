// #961 (found by #996): a resident tile an atlas resize moves takes the finer entries it served to
// its new place; develop left them on the old one, which the new pool no longer holds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuTileAtlas } from './atlas.ts';
import { createWebgpuTilePool } from './pool.ts';
import { poolEncoding } from '../../texture/blockFormats.ts';
import { resizeTileAtlas } from './atlasResize.ts';
import { createWebgpuTilePageTable } from './pageTable.ts';
import { tileId } from './ids.ts';
import { packEntry, tileLayout, TILES_PER_LAYER } from '../../texture/tiles.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { textureDevice } from './textureDevice.fixture.ts';

test('a tile moved by a shrink takes the finer entries it served to its new place', () => {
  installGpuGlobals();
  const { gpu } = textureDevice();
  const options = { kind: 'color', lane: 'lossless', format: 'rgba8unorm', texelBytes: 4 } as const;
  const pool = createWebgpuTilePool(gpu, { ...options, layers: 2 });
  const pages = createWebgpuTilePageTable(gpu, [tileLayout(512, 512)], {
    kind: 'color',
    feedbackOffset: 0,
  });
  const coarse = { slot: 0, level: 1, tx: 1, ty: 0 },
    fine = { slot: 0, level: 0, tx: 2, ty: 1 },
    id = tileId(coarse);
  pool.adopt(TILES_PER_LAYER, id, 5);
  pages.setTile(coarse, pool.placeOf(TILES_PER_LAYER));
  pages.setTile(fine, { x: 3, y: 0, layer: 0 });
  const resident = new Map([[id, TILES_PER_LAYER]]);
  const { pool: next } = resizeTileAtlas(gpu, { ...options, layers: 1 }, 0, pool, pages, resident);
  const moved = packEntry(next.placeOf(resident.get(id)!), 1);
  assert.equal(pages.entryOf(coarse), moved);
  // Level 0 under it: the finer tile at 2,1 stays; the three it served follow it.
  const finer = packEntry({ x: 3, y: 0, layer: 0 }, 0);
  for (let ty = 0; ty < 2; ty++)
    for (let tx = 2; tx < 4; tx++)
      assert.equal(pages.entryOf({ ...fine, tx, ty }), tx === 2 && ty === 1 ? finer : moved);
});

// #961: a budget under the layers' floor keeps the layers and gives fewer tiles; the live resize
// replaces the pool all the same, and what no longer fits its tiles leaves as from a lost layer.
test('a resize to the same layers and fewer tiles evicts past them, tails kept', () => {
  installGpuGlobals();
  const { gpu } = textureDevice();
  const empty = { levels: [], blocks: { bc7: [], astc: [] } };
  const texture = {
    layout: tileLayout(4096, 4096),
    lane: 'lossless' as const,
    source: { kind: 'bytes' as const, tail: empty },
  };
  const lossless = (count: number) => ({ lossless: count, rgba: 0, 'two-channel': 0 });
  const atlas = createWebgpuTileAtlas(gpu, {
    kind: 'color',
    encoding: poolEncoding(undefined),
    layers: lossless(1),
    feedbackOffset: 0,
    textures: [texture],
  });
  atlas.pinTails({ writeTexture() {} } as never, () => {});
  for (let tx = 0; tx < 8; tx++) assert.ok(atlas.place({ slot: 0, level: 0, tx, ty: 0 }, tx));
  assert.equal(atlas.pools[0].resident, 9, 'one tail and eight tiles');
  assert.equal(atlas.resize(gpu, lossless(1)).replaced, 0, 'same layers, same tiles: kept');
  const { evicted, replaced } = atlas.resize(gpu, lossless(1), lossless(4));
  assert.deepEqual([evicted, replaced, atlas.pools[0].tiles], [5, 1, 4]);
  // Places within the tiles stay where they are, slot for slot; the rest had no free place left.
  assert.equal(atlas.pools[0].resident, 4, 'the tail and the three tiles of the kept places');
  assert.equal(atlas.touch({ slot: 0, level: 0, tx: 2, ty: 0 }, 9), true);
  assert.equal(atlas.touch({ slot: 0, level: 0, tx: 3, ty: 0 }, 9), false);
});
