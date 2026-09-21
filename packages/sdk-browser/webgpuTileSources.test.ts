import test from 'node:test';
import assert from 'node:assert/strict';
import { createTileSources } from './webgpuTileSources.ts';
import { createTileCounters } from './webgpuTileCounters.ts';
import { tileLayout } from './textureTiles.ts';
import { poolEncoding } from './textureBlockFormats.ts';
import type { WebgpuTileAtlas } from './webgpuTileAtlas.ts';

// Behaviour: a block level whose bytes are not the whole blocks its dimensions imply is refused
// before a slot is taken — placed first, the tile would stay resident over the texels its slot
// held before, and the failure would only reach the diagnostic.
test('a block level of the wrong length is refused before the tile takes a slot', async () => {
  const placed: unknown[] = [];
  const layout = tileLayout(256, 256);
  const tail = { levels: [], blocks: { bc7: [], astc: [] } };
  const read: string[] = [];
  const atlas = {
    kind: 'color',
    textures: [
      { layout, lane: 'rgba', source: { kind: 'baked', sha256: 'a'.repeat(64), atlas: 0, tail } },
    ],
    roomFor: () => true,
    place: (key: unknown) => (placed.push(key), { x: 0, y: 0, layer: 0 }),
    poolOf: () => ({ texture: {} }),
  } as unknown as WebgpuTileAtlas;
  const sources = createTileSources({
    device: { queue: { writeTexture: () => assert.fail('nothing to write') } } as never,
    readLevel: async ({ format }) => (read.push(format), new Uint8Array(800)),
    encoding: poolEncoding('bc7'),
    counters: createTileCounters(),
    onFailure: () => {},
  });
  const key = { slot: 0, level: 0, tx: 0, ty: 0 };
  assert.equal(
    sources.serve(atlas, key, 1, () => ({}) as never),
    'waiting',
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.throws(() => sources.serve(atlas, key, 2, () => ({}) as never), /TEXTURE_LEVEL_BYTES/);
  assert.deepEqual(placed, []);
  assert.deepEqual(read, ['bc7'], "the level file of the texture's lane");
});
