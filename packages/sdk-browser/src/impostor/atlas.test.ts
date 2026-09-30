// #1239: the atlas streams through the engine's one level reader and the one level store. Each
// level's own url is resolved in it, and the decoded level lands in that reader's budget. Fails on
// develop: `atlas.ts` and `TextureLevelRequest.url` are new.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  impostorLevelId,
  impostorMapRequests,
  loadImpostorAtlas,
  loadImpostorMap,
} from './atlas.ts';
import { createTextureLevelStore } from '../texture/levelStore.ts';
import type { TextureLevelRequest, TextureLevelReader } from '../texture/levelReader.ts';
import type { ImpostorMap, ImpostorMaps } from '../../../sdk-core/src/index.ts';

const LEVELS = [
  { url: '../../objects/aa.bin', sha256: 'a'.repeat(64), bytes: 16, width: 12, height: 12 },
  { url: '../../objects/bb.bin', sha256: 'b'.repeat(64), bytes: 4, width: 3, height: 3 },
];
const map: ImpostorMap = { kind: 'coverage', levels: LEVELS };
const maps: ImpostorMaps = { colourCoverage: map, normalDepth: map, orm: map };

test('each atlas level is requested at its own url, level 0 first', () => {
  assert.deepEqual(impostorMapRequests(map), [
    { sha256: 'a'.repeat(64), atlas: 0, level: 0, format: 'png', url: '../../objects/aa.bin' },
    { sha256: 'b'.repeat(64), atlas: 0, level: 1, format: 'png', url: '../../objects/bb.bin' },
  ]);
});

/** A reader that records what it was asked and answers a level of `bytes` bytes. */
function fakeReader(store: ReturnType<typeof createTextureLevelStore>, bytes = 64) {
  store.keepOnly('k1'); // as `createTextureLevelReader` does, so `take` holds its levels.
  const asked: TextureLevelRequest[] = [];
  const read = (async (request: TextureLevelRequest) => {
    asked.push(request);
    return new Uint8Array(bytes);
  }) as TextureLevelReader;
  return { reader: Object.assign(read, { store, key: 'k1' }) as TextureLevelReader, asked };
}

test('a map reads through the one store, which holds every level under its content address', async () => {
  const store = createTextureLevelStore(1 << 20);
  const { reader, asked } = fakeReader(store);
  const levels = await loadImpostorMap(map, reader);
  assert.equal(levels.length, 2);
  assert.deepEqual(
    asked.map((r) => r.url),
    ['../../objects/aa.bin', '../../objects/bb.bin'],
  );
  assert.equal(store.bytes, 128, 'two 64-byte levels held');
  assert.ok(store.get(impostorLevelId('a'.repeat(64))) instanceof Uint8Array);
  assert.ok(store.get(impostorLevelId('b'.repeat(64))) instanceof Uint8Array);
  // The same store, the same budget: a second read of the same content re-holds nothing extra.
  await loadImpostorMap(map, reader);
  assert.equal(store.bytes, 128);
});

test('the three maps of a card load through the same reader', async () => {
  const store = createTextureLevelStore(1 << 20);
  const { reader, asked } = fakeReader(store, 8);
  const atlas = await loadImpostorAtlas(maps, reader);
  assert.deepEqual(
    [atlas.colourCoverage.length, atlas.normalDepth.length, atlas.orm.length],
    [2, 2, 2],
  );
  assert.equal(asked.length, 6, 'six levels over three maps, one loader');
  // The three maps carry the same two content addresses, held once: one budget, one copy.
  assert.equal(store.bytes, 16);
});
