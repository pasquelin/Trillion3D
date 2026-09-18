import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuTileAtlas } from './webgpuTileAtlas.ts';
import { createWebgpuTilePool } from './webgpuTilePool.ts';
import { resizeTileAtlas } from './webgpuTileAtlasResize.ts';
import { tailId, tileId } from './webgpuTileIds.ts';
import { tileLayout, TILE_PITCH, TILES_PER_LAYER, POOL_LAYER_SIDE } from './textureTiles.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';

installGpuGlobals();

type Copy = { from?: number[]; to?: number[]; size: number[] };

/** Un faux appareil de textures : il note les copies et les textures détruites. */
function textureDevice() {
  const copies: Copy[] = [];
  let destroyed = 0;
  const gpu = {
    createTexture: () => ({
      createView: () => ({}),
      destroy: () => destroyed++,
      format: 'rgba8unorm',
    }),
    createBuffer: () => ({ destroy() {} }),
    createCommandEncoder: () => ({
      copyTextureToTexture: (
        from: { origin?: number[] },
        to: { origin?: number[] },
        size: number[],
      ) => copies.push({ from: from.origin, to: to.origin, size }),
      finish: () => ({}),
    }),
    queue: { writeTexture() {}, writeBuffer() {}, submit() {} },
  };
  return { gpu: gpu as never, copies, destroyed: () => destroyed };
}

const options = { kind: 'color' as const, format: 'rgba8unorm' as const };

test('rétrécir le pool garde les couches qui survivent en une copie, place pour place, et évince le reste', () => {
  const { gpu, copies, destroyed } = textureDevice();
  const layout = tileLayout(4096, 4096);
  const textures = [
    { layout, source: { kind: 'bytes' as const, tail: [] } },
    { layout, source: { kind: 'bytes' as const, tail: [] } },
  ];
  const atlas = createWebgpuTileAtlas(gpu, { ...options, layers: 2, feedbackOffset: 0, textures });
  atlas.pinTails({ writeTexture() {} } as never, () => {});
  // La couche 0 entière, puis cinq tuiles en couche 1 : 2 queues + 903 tuiles.
  for (let i = 0, placed = 0; placed < TILES_PER_LAYER + 3; i++)
    if (atlas.place({ slot: 0, level: 0, tx: i % 32, ty: Math.floor(i / 32) }, 10 + i)) placed++;
  assert.equal(atlas.pool.resident, TILES_PER_LAYER + 5);
  const evicted = atlas.resize(gpu, 1);
  assert.equal(atlas.pool.layers, 1);
  assert.equal(destroyed(), 1, 'l’ancien pool est détruit');
  assert.equal(evicted, 5, 'les cinq tuiles de la couche disparue : rien de libre pour elles');
  assert.equal(atlas.pool.resident, TILES_PER_LAYER);
  assert.deepEqual(copies, [
    { from: undefined, to: undefined, size: [POOL_LAYER_SIDE, POOL_LAYER_SIDE, 1] },
  ]);
  // Les survivantes n'ont pas bougé : la première tuile diffusée est toujours servie, place 2.
  assert.equal(atlas.touch({ slot: 0, level: 0, tx: 0, ty: 0 }, 99), true);
  assert.equal(atlas.touch({ slot: 0, level: 0, tx: 8, ty: 28 }, 99), false, 'tuile 904, évincée');
});

test('une tuile d’une couche disparue est déplacée dans une place libre — les queues d’abord —, copiée et réinscrite', () => {
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
  // Une queue en couche 1 (place 950), une tuile récente en couche 1 (951), une ancienne (952),
  // et une tuile en couche 0 qui reste où elle est.
  const resident = new Map<number, number>();
  pool.adopt(5, tileId({ slot: 0, level: 0, tx: 5, ty: 0 }), 3);
  resident.set(tileId({ slot: 0, level: 0, tx: 5, ty: 0 }), 5);
  pool.adopt(950, tailId(1), 0, true);
  pool.adopt(951, tileId({ slot: 0, level: 0, tx: 7, ty: 0 }), 9);
  resident.set(tileId({ slot: 0, level: 0, tx: 7, ty: 0 }), 951);
  pool.adopt(952, tileId({ slot: 0, level: 0, tx: 6, ty: 0 }), 4);
  resident.set(tileId({ slot: 0, level: 0, tx: 6, ty: 0 }), 952);
  const result = resizeTileAtlas(gpu, { ...options, layers: 1 }, pool, pages as never, resident);
  assert.equal(result.evicted, 0, 'trois places libres suffisent');
  assert.equal(result.pool.resident, 4);
  // Queue d'abord (place 0), puis la plus regardée (place 1), puis l'ancienne (place 2).
  assert.deepEqual(calls, ['tail 1 → 0,0,0', 'tile 7 → 1,0,0', 'tile 6 → 2,0,0']);
  assert.equal(copies.length, 1 + 3, 'la couche commune, puis une cellule par tuile déplacée');
  assert.deepEqual(copies[1], {
    // Place 950 = couche 1, ligne 1, colonne 20.
    from: [20 * TILE_PITCH, TILE_PITCH, 1],
    to: [0, 0, 0],
    size: [TILE_PITCH, TILE_PITCH, 1],
  });
  assert.equal(resident.get(tileId({ slot: 0, level: 0, tx: 7, ty: 0 })), 1);
  assert.equal(resident.get(tileId({ slot: 0, level: 0, tx: 5, ty: 0 })), 5, 'pas bougé');
});

test('agrandir le pool garde le compte des résidentes, et un pool plein pour la vue refuse avant toute lecture', () => {
  const { gpu, copies } = textureDevice();
  const layout = tileLayout(4096, 4096);
  const textures = [{ layout, source: { kind: 'bytes' as const, tail: [] } }];
  const atlas = createWebgpuTileAtlas(gpu, { ...options, layers: 1, feedbackOffset: 0, textures });
  atlas.pinTails({ writeTexture() {} } as never, () => {});
  for (let i = 0; i < TILES_PER_LAYER - 1; i++)
    atlas.place({ slot: 0, level: 0, tx: i % 32, ty: Math.floor(i / 32) }, 10);
  assert.equal(atlas.pool.resident, TILES_PER_LAYER, 'plein : une queue et 899 tuiles');
  // Tout a été regardé à l'image 10 : à l'image 11, rien n'est cédable — refus compté, sans place prise.
  assert.equal(atlas.roomFor(11), false);
  assert.equal(atlas.refused, 1);
  // À l'image 12, ce qui date de l'image 10 est cédable.
  assert.equal(atlas.roomFor(12), true);
  assert.equal(atlas.resize(gpu, 2), 0, 'agrandir n’évince rien');
  assert.equal(atlas.pool.resident, TILES_PER_LAYER, 'le compte survit à l’adoption');
  assert.equal(copies.length, 1);
  assert.equal(atlas.roomFor(11), true, 'une couche libre');
});
