import test from 'node:test';
import assert from 'node:assert/strict';
import { createTileSources } from './sources.ts';
import { createTileCounters } from './counters.ts';
import { tileLayout } from '../../texture/tiles.ts';
import { poolEncoding } from '../../texture/blockFormats.ts';
import type { WebgpuTileAtlas } from './atlas.ts';

// Behaviour: a block level whose bytes are not the whole blocks its dimensions imply is refused
// where its read resolves — one failure, never held, never read again — and no tile of it takes
// a slot: placed, the tile would stay resident over the texels its slot held before.
test('a block level of the wrong length fails once, is never held, and takes no slot', async () => {
  const placed: unknown[] = [];
  const failures: string[] = [];
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
    readLevel: async ({ format }) => (read.push(format), new Uint8Array(1)),
    encoding: poolEncoding('bc7'),
    counters: createTileCounters(),
    onFailure: (phase, error) => failures.push(`${phase}: ${(error as Error).message}`),
  });
  const key = { slot: 0, level: 0, tx: 0, ty: 0 };
  const serve = (frame: number) => sources.serve(atlas, key, frame, () => ({}) as never);
  assert.equal(serve(1), 'waiting');
  await sources.settled();
  assert.equal(serve(2), 'waiting');
  await sources.settled();
  assert.deepEqual(failures, [
    `texture-level-read-failed ${'a'.repeat(64)}/0/0: TEXTURE_LEVEL_BYTES 256x256: 1`,
  ]);
  assert.equal(sources.levels?.bytes, 0, 'the short level is not held');
  assert.deepEqual(placed, []);
  assert.deepEqual(read, ['bc7'], "the level file of the texture's lane, read once");
});
