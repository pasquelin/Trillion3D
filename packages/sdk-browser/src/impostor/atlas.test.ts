// The card atlas streams through the engine's one held-level read, the tiles' own
// (`heldLevelsOf`): each level is read at its own url, once even while it is in flight, held in the
// one page cache, and a failed read is reported.
import test from 'node:test'
import assert from 'node:assert/strict'
import './lent.fixture.ts'
import { impostorAtlasAsks, impostorAtlasBytes, loadImpostorAtlas } from './atlas.ts'
import { heldLevelsOf, LevelBytesError } from '../texture/heldLevels.ts'
import type { TextureLevelRequest, TextureLevelReader } from '../texture/levelReader.ts'
import { createPageCache } from '../streaming/pageCache.ts'
import type { ImpostorMap, ImpostorMaps } from '../../../sdk-core/src/index.ts'

const level = (name: string) => ({
  url: `../../objects/${name}.png`,
  sha256: name.repeat(64),
  bytes: 16,
  width: 4,
  height: 4,
})
const chain = (kind: string, ...names: string[]): ImpostorMap => ({
  kind,
  levels: names.map(level),
})
const maps: ImpostorMaps = {
  colourCoverage: chain('coverage', 'a', 'b'),
  normalDepth: chain('data', 'c'),
  orm: chain('data', 'd'),
}

/** A decoded 4×4 level, as the browser hands a lossless one. */
const bitmap = () => ({ width: 4, height: 4, close() {} }) as ImageBitmap

/** A reader over a page cache for one cook, as `createTextureLevelReader` makes it. */
function fakeReader() {
  const store = createPageCache()
  const asked: TextureLevelRequest[] = []
  const read = async (request: TextureLevelRequest) => {
    asked.push(request)
    if (request.url?.endsWith('d.png')) throw new Error('404')
    return bitmap()
  }
  return { reader: Object.assign(read, { store, key: 'k1' }) as TextureLevelReader, asked, store }
}

const settle = () => new Promise((resolve) => setImmediate(resolve))

test('the atlas reads each level once at its own url, held by the one cache, a failure reported', async (t) => {
  // The failed level's wait runs on the test's timers.
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { reader, asked, store } = fakeReader()
  const failed: string[] = []
  const levels = heldLevelsOf(reader)
  const asks = impostorAtlasAsks(maps, levels)
  const report = (address: { sha256: string }) => void failed.push(address.sha256)
  assert.equal(loadImpostorAtlas(asks, levels, report), 'waiting', 'asked, not yet held')
  assert.equal(loadImpostorAtlas(asks, levels, report), 'waiting')
  assert.deepEqual(
    asked.map((request) => [request.url, request.level]),
    [
      ['../../objects/a.png', 0],
      ['../../objects/b.png', 1],
      ['../../objects/c.png', 0],
      ['../../objects/d.png', 0],
    ],
    'a read in flight is never asked again',
  )
  await settle()
  assert.deepEqual(failed, ['d'.repeat(64)], 'the failed level is reported, not swallowed')
  assert.equal(store.levelBytes, 3 * 64, 'three levels held, in the one cache')
  assert.equal(loadImpostorAtlas(asks, levels, report), 'waiting', 'the failed level waits')
  await settle()
  // The level comes from another reader of the cache, for the same cook. Once every level is
  // held, the atlas is handed over, and nothing is read again.
  const other = heldLevelsOf(Object.assign(async () => bitmap(), { store, key: 'k1' }))
  const d = { sha256: 'd'.repeat(64), atlas: 0, level: 0, format: 'png' } as const
  assert.equal(other.read(d, [4, 4], report), 'waiting')
  await other.settled()
  const atlas = loadImpostorAtlas(asks, levels, report)
  assert.notEqual(typeof atlas, 'string')
  const counts = Object.values(atlas as object).map((levels: unknown[]) => levels.length)
  assert.deepEqual(counts, [2, 1, 1])
  assert.equal(asked.length, 4, 'nothing read again: the failed level not before its wait')
})

test('a level that failed for good fails its atlas: nothing will ever come', async () => {
  const store = createPageCache()
  const read = async ({ url }: TextureLevelRequest) => {
    if (url?.endsWith('c.png')) throw new LevelBytesError([4, 4], 3)
    return bitmap()
  }
  const levels = heldLevelsOf(Object.assign(read, { store, key: 'k2' }) as TextureLevelReader)
  const asks = impostorAtlasAsks(maps, levels),
    told: string[] = []
  const report = (address: { sha256: string }) => void told.push(address.sha256)
  assert.equal(loadImpostorAtlas(asks, levels, report), 'waiting')
  await levels.settled()
  assert.equal(loadImpostorAtlas(asks, levels, report), 'failed')
  assert.deepEqual(told, ['c'.repeat(64)], 'its failure told once')
})

test('levels held while gathered stay as others land past the room; let go, they leave by last use', async () => {
  // Room for three 4×4 levels: the atlas's four would evict one another as they land.
  const store = createPageCache(3 * 64)
  const levels = heldLevelsOf(Object.assign(async () => bitmap(), { store, key: 'k3' }))
  const asks = impostorAtlasAsks(maps, levels)
  assert.equal(impostorAtlasBytes(maps), 4 * 64)
  const [first, ...rest] = asks.all
  levels.hold([first])
  assert.equal(levels.readAsked(first, assert.fail), 'waiting')
  await levels.settled()
  // Two rounds: the reads in flight hold their room, so the last waits for the first ones.
  for (let round = 0; round < 2; round++) {
    for (const ask of rest) levels.readAsked(ask, assert.fail)
    await levels.settled()
  }
  assert.notEqual(typeof levels.readAsked(first, assert.fail), 'string', 'the held level stayed')
  assert.equal(store.levelBytes, 3 * 64)
  levels.letGo([first])
  assert.equal(store.heldBytes, 0)
})
