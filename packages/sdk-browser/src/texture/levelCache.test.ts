// The texture levels are entries of the one host cache (`streaming/pageCache.ts`): held across a
// device loss, counted once, evicted by last use within the one budget before a page a frame
// keeps, the proxy after them, and following `world.budget.cpu` live.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTextureLevelReader, type TextureLevelAddress } from './levelReader.ts'
import { heldLevelsOf, type HeldLevels } from './heldLevels.ts'
import { tileRecord } from './tileRecords.ts'
import { tiledLevelBytes } from './tileRecords.fixture.ts'
import { createPageCache, type PageCache } from '../streaming/pageCache.ts'
import { manifestTableBytes } from '../streaming/manifestTables.ts'
import { createPageStreamer } from '../streaming/pageStreamer.ts'
import { servedPages } from '../streaming/servedPages.fixture.ts'
import { retained } from '../streaming/retained.fixture.ts'
import { worldBudget, worldPools } from '../world/core/worldBudget.ts'
import { DEFAULT_PHYSICS_BUDGET } from '../../../sdk-core/src/physics/index.ts'
import { MIB } from '../../../math/src/constants.ts'

const BASE = 'https://host/cache/full/clusters.json'
const textures = { url: '../../textures/v6/{sha}/{kind}-{level}.{format}', version: 6 }
/** Bytes of tile (0, 0)'s record in a `side`² block level file: what a session holds of it. */
const recordBytes = (side: number) => tileRecord(side, side, 0, 0).bytes
/** The level `level` of one texture, block-compressed or lossless. */
const address = (level: number, format: 'bc7' | 'png' = 'bc7'): TextureLevelAddress => ({
  sha256: 'b'.repeat(64),
  atlas: 1,
  level,
  format,
})
/** Asks tile (0, 0) of `key` of `side`² texels from `levels`. */
const askTile = (levels: HeldLevels, key: TextureLevelAddress, side: number) =>
  levels.read(key, [side, side], assert.fail)

/** A session's levels of `format`, read by the explorer's reader through `cache` under the cook
 *  `key`, from a server that honours Range; `fetched` lists every level address it was asked. */
function session(cache: PageCache, key = 'k1', side = 1024, format: 'bc7' | 'png' = 'bc7') {
  const fetched: string[] = []
  globalThis.createImageBitmap ??= (() => Promise.reject(new Error('unused'))) as never
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    fetched.push(String(url))
    const file = new Uint8Array(tiledLevelBytes(side, side)),
      range = new Headers(init?.headers).get('range')
    if (!range) return new Response(file)
    const [from, to] = range.slice(6).split('-').map(Number)
    return new Response(file.slice(from, to + 1), { status: 206 })
  }) as typeof fetch
  const levels = heldLevelsOf(createTextureLevelReader({ textures, key }, BASE, cache)!)
  /** Asks tile (0, 0) of `level`, and waits for what it read. */
  const ask = async (level: number) => {
    askTile(levels, address(level, format), side)
    await levels.settled()
  }
  return { levels, fetched, ask }
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
  assert.equal(other.fetched.length, 1)
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
  // Two decoded 512² levels, 1 MiB each: both fit the default total, one alone fits the one below.
  const side = 512,
    bytes = side * side * 4
  const scope = globalThis as { createImageBitmap?: unknown },
    decoder = scope.createImageBitmap
  scope.createImageBitmap = async () => ({ width: side, height: side, close() {} })
  try {
    const { levels, ask } = session(pools.pageCache, 'k1', side, 'png')
    await ask(0)
    await ask(1)
    assert.equal(levels.bytes, 2 * bytes)
    handle.cpu = (3 * MIB) / 2
    assert.equal(levels.bytes, bytes, 'the level read first left')
    assert.ok(askTile(levels, address(1, 'png'), side) !== 'waiting', 'the one read last stays')
  } finally {
    scope.createImageBitmap = decoder
  }
})
