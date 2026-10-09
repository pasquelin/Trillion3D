// The card atlas streams through the engine's one held-level read, the tiles' own
// (`heldLevelsOf`): each level is read at its own url, once even while it is in flight, held in the
// one page cache, and a failed read is reported.
import test from 'node:test'
import assert from 'node:assert/strict'
import './lent.fixture.ts'
import { loadImpostorAtlas } from './atlas.ts'
import { heldLevelsOf, levelId } from '../texture/heldLevels.ts'
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
  const report = (address: { sha256: string }) => void failed.push(address.sha256)
  assert.equal(loadImpostorAtlas(maps, levels, 0, report), 'waiting', 'asked, not yet held')
  assert.equal(loadImpostorAtlas(maps, levels, 1, report), 'waiting')
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
  assert.equal(loadImpostorAtlas(maps, levels, 2, report), 'waiting', 'the failed level waits')
  await settle()
  // The level comes from another reader of the cache. Once every level is held, the atlas is
  // handed over, and nothing is read again.
  const d = { sha256: 'd'.repeat(64), atlas: 0, level: 0, format: 'png' } as const
  store.keepLevel(levelId('k1', d, true, 0, 0), bitmap())
  const atlas = loadImpostorAtlas(maps, levels, 3, report)
  assert.notEqual(typeof atlas, 'string')
  const counts = Object.values(atlas as object).map((levels: unknown[]) => levels.length)
  assert.deepEqual(counts, [2, 1, 1])
  assert.equal(asked.length, 4, 'nothing read again: the failed level not before its wait')
})
