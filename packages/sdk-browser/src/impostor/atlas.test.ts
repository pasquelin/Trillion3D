// #1335: the card atlas streams through the engine's one held-level read, the tiles' own
// (`readHeldLevel`): each level is read at its own url, once even while it is in flight, held by
// the reader's store within its room, and a failed read is reported. Fails on develop: `atlas.ts`
// is not there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadImpostorAtlas } from './atlas.ts';
import { createHeldLevels } from '../texture/heldLevels.ts';
import { createTextureLevelStore } from '../texture/levelStore.ts';
import type { TextureLevelRequest, TextureLevelReader } from '../texture/levelReader.ts';
import type { ImpostorMap, ImpostorMaps } from '../../../sdk-core/src/index.ts';

const level = (name: string) => ({
  url: `../../objects/${name}.png`,
  sha256: name.repeat(64),
  bytes: 16,
  width: 4,
  height: 4,
});
const chain = (kind: string, ...names: string[]): ImpostorMap => ({
  kind,
  levels: names.map(level),
});
const maps: ImpostorMaps = {
  colourCoverage: chain('coverage', 'a', 'b'),
  normalDepth: chain('data', 'c'),
  orm: chain('data', 'd'),
};

/** A decoded 4×4 level, as the browser hands a lossless one. */
const bitmap = () => ({ width: 4, height: 4, close() {} }) as ImageBitmap;

/** A reader over a store opened for one cook, as `createTextureLevelReader` makes it. */
function fakeReader() {
  const store = createTextureLevelStore(1 << 20);
  store.keepOnly('k1');
  const asked: TextureLevelRequest[] = [];
  const read = (async (request: TextureLevelRequest) => {
    asked.push(request);
    if (request.url?.endsWith('d.png')) throw new Error('404');
    return bitmap();
  }) as TextureLevelReader;
  return { reader: Object.assign(read, { store, key: 'k1' }) as TextureLevelReader, asked, store };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('the atlas reads each level once at its own url, held by the one store, a failure reported', async () => {
  const { reader, asked, store } = fakeReader();
  const failed: string[] = [];
  const levels = createHeldLevels({
    read: reader,
    onFailure: (key) => failed.push(key.sha256),
  });
  assert.equal(loadImpostorAtlas(maps, levels, 0), 'waiting', 'asked, not yet held');
  assert.equal(loadImpostorAtlas(maps, levels, 1), 'waiting');
  assert.deepEqual(
    asked.map((request) => [request.url, request.level]),
    [
      ['../../objects/a.png', 0],
      ['../../objects/b.png', 1],
      ['../../objects/c.png', 0],
      ['../../objects/d.png', 0],
    ],
    'a read in flight is never asked again',
  );
  await settle();
  assert.deepEqual(failed, ['d'.repeat(64)], 'the failed level is reported, not swallowed');
  assert.equal(store.bytes, 3 * 64, 'three levels held, in the one store');
  assert.equal(loadImpostorAtlas(maps, levels, 2), 'waiting', 'the failed level is asked again');
  await settle();
  // The level comes from another reader of the store. Once every level is held, the atlas is handed over, and nothing is read again.
  store.take(`${'d'.repeat(64)}/0/0/png`, bitmap(), 'k1');
  const atlas = loadImpostorAtlas(maps, levels, 3);
  assert.notEqual(typeof atlas, 'string');
  const counts = Object.values(atlas as object).map((chain: unknown[]) => chain.length);
  assert.deepEqual(counts, [2, 1, 1]);
  assert.equal(asked.length, 5, 'only the failed level was read again');
});
