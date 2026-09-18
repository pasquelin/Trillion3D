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
  TILE_PITCH,
  tileLayout,
  tilesAt,
  TILES_PER_LAYER,
} from './textureTiles.ts';

test('une texture 2048² a cinq niveaux diffusés de 256 + 64 + 16 + 4 + 1 tuiles, et sa queue commence au 64', () => {
  const layout = tileLayout(2048, 2048);
  assert.equal(layout.tail, 5);
  assert.equal(layout.last, 11);
  assert.deepEqual(layout.offsets, [0, 256, 320, 336, 340]);
  assert.equal(layout.entries, 341);
  assert.deepEqual(tilesAt(2048, 2048, 4), [1, 1]);
});

test('une texture sous 64 texels n’a aucun niveau diffusé : tout est dans la queue', () => {
  const layout = tileLayout(4, 3);
  assert.equal(layout.tail, 0);
  assert.equal(layout.last, 2);
  assert.deepEqual(layout.offsets, []);
  assert.equal(layout.entries, 0);
  // 100×40 : le niveau 0 dépasse 64 en largeur, le niveau 1 (50×20) tient.
  assert.equal(tileLayout(100, 40).tail, 1);
  assert.deepEqual(tilesAt(100, 40, 0), [1, 1]);
  assert.throws(() => tileLayout(0, 4), /INVALID_TEXTURE_SIZE/);
  assert.throws(() => tileLayout(1 << 16, 4), /TEXTURE_TOO_LARGE/);
});

test('les niveaux de la queue se rangent côte à côte sous 128 texels', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(tailOffset), [0, 64, 96, 112, 120, 124, 126]);
  assert.equal(tailOffset(6) + 1, 127);
  assert.equal(POOL_LAYER_SIDE, 30 * TILE_PITCH);
});

test('une place du pool a un rang unique, et l’entrée de table garde place et niveau', () => {
  const place = { x: 29, y: 7, layer: 3 };
  assert.deepEqual(placeOf(placeIndex(place)), place);
  assert.equal(placeIndex({ x: 0, y: 0, layer: 1 }), TILES_PER_LAYER);
  const word = packEntry(place, 9);
  assert.equal(entryLevel(word), 9);
  assert.deepEqual(entryPlace(word), place);
  assert.ok(word > 0x7fffffff, 'le bit haut dit que l’entrée est servie');
});
