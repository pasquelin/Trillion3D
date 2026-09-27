// #961 (found by #996): a resident tile an atlas resize moves takes the finer entries it served to
// its new place; develop left them on the old one, which the new pool no longer holds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuTilePool } from './pool.ts';
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
