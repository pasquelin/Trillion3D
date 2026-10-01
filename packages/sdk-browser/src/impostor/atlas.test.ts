// #1335: the card atlas streams through the engine's one level reader and its one store. Each level
// is read at its own url, handed to the GPU feed, then held by the store within its budget; a level
// the store already holds is not read again. Fails on develop: `atlas.ts` is not there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadImpostorAtlas } from './atlas.ts';
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

/** A reader over a store opened for one cook, as `createTextureLevelReader` makes it. */
function fakeReader() {
  const store = createTextureLevelStore(1 << 20);
  store.keepOnly('k1');
  const asked: TextureLevelRequest[] = [];
  const read = (async (request: TextureLevelRequest) => {
    asked.push(request);
    return new Uint8Array(8);
  }) as TextureLevelReader;
  return { reader: Object.assign(read, { store, key: 'k1' }) as TextureLevelReader, asked, store };
}

test('the atlas reads each level at its own url, hands it over, then the store holds it', async () => {
  const { reader, asked, store } = fakeReader();
  const counts = await loadImpostorAtlas(maps, reader, (atlas) => {
    assert.equal(store.bytes, 0, 'the feed sees the levels before the store takes them');
    return [atlas.colourCoverage.length, atlas.normalDepth.length, atlas.orm.length];
  });
  assert.deepEqual(counts, [2, 1, 1]);
  assert.deepEqual(
    asked.map((request) => [request.url, request.level]),
    [
      ['../../objects/a.png', 0],
      ['../../objects/b.png', 1],
      ['../../objects/c.png', 0],
      ['../../objects/d.png', 0],
    ],
  );
  assert.equal(store.bytes, 32, 'four levels held, one budget');
  // Read again — an atlas the GPU feed let go —, every level comes from the store.
  await loadImpostorAtlas(maps, reader, () => undefined);
  assert.equal(asked.length, 4, 'nothing read twice');
  assert.equal(store.bytes, 32);
});
