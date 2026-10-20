// The texture levels are entries of the one host cache (`geometry/streaming/pageCache.ts`): held across a
// device loss, counted once, evicted by last use within the one budget before a page a frame
// keeps, the proxy after them, and following `world.budget.cpu` live.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createTextureLevelReader,
  tileLevelBytes,
  type TextureLevelAddress,
} from './levelReader.ts'
import { heldLevelsOf, type HeldLevels } from './heldLevels.ts'
import { tileRecord } from './tileRecords.ts'
import { tiledLevelFile } from './tileRecords.fixture.ts'
import { tilesAt } from './tiles.ts'
import { createPageCache, type PageCache } from '../../geometry/streaming/pageCache.ts'
import { manifestTableBytes } from '../../geometry/streaming/manifestTables.ts'
import { createPageStreamer } from '../../geometry/streaming/pageStreamer.ts'
import { servedPages } from '../../geometry/streaming/servedPages.fixture.ts'
import { retained } from '../../geometry/streaming/retained.fixture.ts'
import { worldBudget, worldPools } from '../../session/world/budget.ts'
import { DEFAULT_PHYSICS_BUDGET } from '../../../../sdk-core/src/physics/options.ts'

const BASE = 'https://host/cache/full/clusters.json'
const textures = { url: '../../textures/v6/{sha}/{kind}-{level}.{format}', version: 6 }
/** Bytes of tile (0, 0)'s record in a `side`² block level file: what a session holds of it. */
const recordBytes = (side: number) => tileRecord(side, side, 0, 0).bytes
/** The level `level` of one texture, as blocks or decoded to RGBA8. */
const address = (level: number, rgba = false): TextureLevelAddress => ({
  sha256: 'b'.repeat(64),
  atlas: 1,
  level,
  format: 'bc7',
  rgba,
})
/** Asks tile (0, 0) of `key` of `side`² texels from `levels`. */
const askTile = (levels: HeldLevels, key: TextureLevelAddress, side: number) =>
  levels.read(key, [side, side], assert.fail)

/** A session's levels, as blocks or decoded (`rgba`), read by the explorer's reader through
 *  `cache` under the cook `key`, from a server that honours Range; `fetched` lists every level
 *  address it was asked. */
function session(cache: PageCache, key = 'k1', side = 1024, rgba = false) {
  const fetched: string[] = []
  const { file } = tiledLevelFile(side, side)
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    fetched.push(String(url))
    const range = new Headers(init?.headers).get('range')
    if (!range) return new Response(file)
    const [from, to] = range.slice(6).split('-').map(Number)
    return new Response(file.slice(from, to + 1), { status: 206 })
  }) as typeof fetch
  const levels = heldLevelsOf(createTextureLevelReader({ textures, key }, BASE, cache)!)
  /** Asks tile (0, 0) of `level`, and waits for what it read. */
  const ask = async (level: number) => {
    askTile(levels, address(level, rgba), side)
    await levels.settled()
  }
  /** Asks every tile of `level`, one after the other. */
  const askEvery = async (level: number) => {
    const [across, down] = tilesAt(side, side, 0)
    for (let t = 0; t < across * down; t++) {
      levels.read(address(level, rgba), [side, side], assert.fail, t % across, (t / across) | 0)
      await levels.settled()
    }
  }
  return { levels, fetched, ask, askEvery }
}

test('after a device loss the texture levels are rebuilt with no level read again', async () => {
  const cache = createPageCache()
  await session(cache).ask(0)
  const reopened = session(cache)
  assert.ok(askTile(reopened.levels, address(0), 1024) instanceof Uint8Array, 'held')
  assert.deepEqual([reopened.fetched, reopened.levels.fetched], [[], 0], '0 texture refetch')
  // Another cook's level of the same address is another file: read, never served from this one.
  const other = session(cache, 'k2')
  await other.ask(0)
  assert.equal(other.fetched.length, 2, 'its head, then its record')
  assert.equal(cache.levelBytes, 2 * recordBytes(1024))
})

test('a level read by both sides of a device loss is counted once', async () => {
  const cache = createPageCache()
  const lost = session(cache)
  askTile(lost.levels, address(0), 1024)
  const reopened = session(cache)
  await reopened.ask(0)
  await lost.levels.settled()
  assert.equal(cache.levelBytes, recordBytes(1024))
})

test('a small CPU total: no page a frame keeps is refused for a texture level, the proxy stays', async () => {
  const urls = ['http://cache/a', 'http://cache/b']
  const proxy = 32
  // Room for the tables, one transfer, the two pages and the proxy, not for the level beside.
  const tables = manifestTableBytes(urls.map((url) => ({ url })))
  const cache = createPageCache(tables + 64 + 24 + proxy)
  await cache.keep('proxy', proxy, async () => new ArrayBuffer(proxy))
  const { levels, ask } = session(cache, 'k1', 8)
  await ask(0)
  assert.equal(levels.bytes, 64, 'held while no session reserves its room')
  const { pages, fetched } = await servedPages(urls)
  const streamer = createPageStreamer(pages, 'http://cache/', { cache, maxTransferBytes: 64 })
  retained(streamer, urls)(urls)
  await streamer.request(urls, { signal: streamer.signal })
  const { evictions, admissionBlocked } = streamer.stats()
  assert.deepEqual([urls.every(streamer.has), evictions, admissionBlocked], [true, 0, 0])
  assert.deepEqual([levels.bytes, cache.weight('proxy')], [0, proxy], 'the level left first')
  for (let frame = 1; frame < 4; frame++) await ask(0)
  assert.deepEqual(fetched, urls, 'a level that cannot fit is not read again')
  assert.equal(askTile(levels, address(0), 8), 'refused', 'refused, not waited for')
  streamer.dispose()
})

test('the texture levels follow world.budget.cpu live, the least recently read leaving first', async () => {
  const pools = worldPools()
  const physics = { ...DEFAULT_PHYSICS_BUDGET }
  const handle = worldBudget(pools, { explorer: null }, { last: null }, physics)
  // Two 512² levels decoded to RGBA8, every tile: both fit the default total, one alone fits the
  // one below.
  const side = 512,
    [across, down] = tilesAt(side, side, 0)
  let bytes = 0
  for (let t = 0; t < across * down; t++)
    bytes += tileLevelBytes(tileRecord(side, side, t % across, (t / across) | 0).bytes, true)
  const { levels, askEvery } = session(pools.pageCache, 'k1', side, true)
  await askEvery(0)
  await askEvery(1)
  assert.equal(levels.bytes, 2 * bytes)
  handle.cpu = bytes
  assert.ok(levels.bytes <= bytes)
  for (let t = 0; t < across * down; t++) {
    const tile = [
      address(1, true),
      [side, side],
      assert.fail,
      t % across,
      (t / across) | 0,
    ] as const
    assert.ok(levels.read(...tile) instanceof Uint8Array, `the level read last stays: tile ${t}`)
  }
  assert.equal(askTile(levels, address(0, true), side), 'waiting', 'the level read first left')
})
