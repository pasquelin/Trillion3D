// A session's evictions through the cache's eviction order (`cache.ts`, `cacheEvictionOrder.ts`): the
// pages develop's walk (`evictOldest` over the cache's `Map`, past the session's pins) evicted.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createPageStreamerWith } from './pageStreamer.ts'
import { createPageCache } from './pageCache.ts'
import { manifestTableBytes } from './manifestTables.ts'
import { evictOldest } from './evictOldest.ts'
import { servedPages } from './servedPages.fixture.ts'
import { random } from '../page/cut/cutRuleChecks.fixture.ts'

const TRANSFER = 64,
  PAGE = 12

test('random pins, reads and totals: the session evicts what the walk past its pins evicted', async () => {
  const urls = Array.from({ length: 24 }, (_, i) => `p${i}.bin`)
  const { pages } = await servedPages(urls)
  const reserved = manifestTableBytes(pages) + TRANSFER
  for (const seed of [3, 914]) {
    const draw = random(seed)
    const cache = createPageCache(reserved + urls.length * PAGE)
    const evicted: string[] = []
    const streamer = createPageStreamerWith(pages, 'http://cache/', {
      cache,
      workerCount: 2,
      onEvict: (url) => evicted.push(url),
      maxTransferBytes: TRANSFER,
    })
    let pins: string[] = []
    /** What the walk takes from `order`: oldest first, past the pins, until the pages fit. */
    const walk = (order: string[], budget: number) => {
      const expected: string[] = []
      let bytes = order.length * PAGE
      evictOldest(
        order,
        () => bytes > budget,
        (key) => pins.includes(key),
        (key) => {
          expected.push(key)
          bytes -= PAGE
        },
      )
      return expected
    }
    for (let step = 0; step < 160; step++) {
      const roll = draw(),
        url = urls[Math.floor(draw() * urls.length)]
      const order = [...cache.pages.keys()]
      let expected: string[] = []
      evicted.length = 0
      if (roll < 0.35) {
        // A page read lands as the most recent, then the cache evicts; a page held is a hit.
        if (!order.includes(url)) expected = walk([...order, url], cache.budgetBytes)
        await streamer.request([url])
        await new Promise((settled) => setTimeout(settled, 0))
      } else if (roll < 0.45) streamer.get(url)
      else if (roll < 0.7) {
        pins = urls.filter(() => draw() < 0.2)
        expected = walk(order, cache.budgetBytes)
        streamer.retain(pins)
      } else {
        const total = reserved + Math.floor(draw() * urls.length) * PAGE
        expected = walk(order, total - reserved)
        cache.resize(total)
      }
      assert.deepEqual(evicted, expected, `seed ${seed}, step ${step}`)
    }
    streamer.dispose()
  }
})

test('a session another one replaced evicts as the walk past its own pins did', async () => {
  const urls = ['a.bin', 'b.bin', 'c.bin']
  const { pages } = await servedPages(urls)
  const cache = createPageCache(manifestTableBytes(pages) + TRANSFER + 3 * PAGE)
  const open = (maxPages?: number) =>
    createPageStreamerWith(pages, 'http://cache/', {
      cache,
      maxPages,
      workerCount: 1,
      maxTransferBytes: TRANSFER,
    })
  // One page at most, all three pinned: they stay.
  const before = open(1)
  before.retain(urls)
  await before.request(urls)
  assert.deepEqual([...cache.pages.keys()], urls)
  // The next session reads through the cache before the first one closes, and pins `b`: the order
  // keeps its holds now. The first one's eviction still walks past its own pin alone.
  const after = open()
  after.retain(['b.bin'])
  before.retain(['a.bin'])
  assert.deepEqual([...cache.pages.keys()], ['a.bin'])
  before.dispose()
  after.dispose()
})
