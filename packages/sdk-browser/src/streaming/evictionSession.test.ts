// The cache's evictions as its sessions read (`pageCache.ts`, `cacheEntries.ts`): the least
// recently used pages past the sessions' pins, until the pages fit.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createPageStreamer } from './pageStreamer.ts'
import { createPageCache } from './pageCache.ts'
import { manifestTableBytes } from './manifestTables.ts'
import { servedPages } from './servedPages.fixture.ts'
import { retained } from './retained.fixture.ts'
import { lcgRandom } from '../../../math/src/sequence/random.ts'

const TRANSFER = 64,
  PAGE = 12

/** The pages of `urls` `cache` holds. */
const held = (cache: ReturnType<typeof createPageCache>, urls: readonly string[]) =>
  urls.filter((url) => cache.page(url))

test('random pins, reads and totals: the session evicts the least recently used pages past its pins', async () => {
  const urls = Array.from({ length: 24 }, (_, i) => `p${i}.bin`)
  const { pages } = await servedPages(urls)
  const reserved = manifestTableBytes(pages) + TRANSFER
  for (const seed of [3, 914]) {
    const draw = lcgRandom(seed)
    const cache = createPageCache(reserved + urls.length * PAGE)
    const evicted: string[] = []
    const streamer = createPageStreamer(pages, 'http://cache/', {
      cache,
      workerCount: 2,
      onEvict: (url) => evicted.push(url),
      maxTransferBytes: TRANSFER,
    })
    const retain = retained(streamer, urls)
    let pins: string[] = []
    /** The pages cached, least recently used first: the test's own model of the cache. */
    let order: string[] = []
    /** `url` used last. */
    const used = (url: string) => (order = [...order.filter((key) => key !== url), url])
    /** What leaves `cached`, least recently used first: the pages past the pins, until they fit. */
    const walk = (cached: string[], budget: number) => {
      const over = Math.max(0, Math.ceil((cached.length * PAGE - budget) / PAGE))
      return cached.filter((key) => !pins.includes(key)).slice(0, over)
    }
    for (let step = 0; step < 160; step++) {
      const roll = draw(),
        url = urls[Math.floor(draw() * urls.length)]
      let expected: string[] = []
      evicted.length = 0
      if (roll < 0.35) {
        // A page read lands as the most recent, then the cache evicts; a page held is a hit.
        if (!order.includes(url)) expected = walk([...order, url], cache.budgetBytes)
        await streamer.request([url], { signal: streamer.signal })
        await new Promise((settled) => setTimeout(settled, 0))
        used(url)
      } else if (roll < 0.45) {
        if (streamer.get(url)) used(url)
      } else if (roll < 0.7) {
        pins = urls.filter(() => draw() < 0.2)
        expected = walk(order, cache.budgetBytes)
        retain(pins)
      } else {
        const total = reserved + Math.floor(draw() * urls.length) * PAGE
        expected = walk(order, total - reserved)
        cache.resize(total)
      }
      assert.deepEqual(evicted, expected, `seed ${seed}, step ${step}`)
      order = order.filter((key) => !evicted.includes(key))
      assert.deepEqual(
        held(cache, urls),
        urls.filter((key) => order.includes(key)),
      )
    }
    streamer.dispose()
  }
})

test('two sessions over one cache: what either pins stays', async () => {
  const urls = ['a.bin', 'b.bin', 'c.bin']
  const { pages } = await servedPages(urls)
  const cache = createPageCache(2 * (manifestTableBytes(pages) + TRANSFER) + 2 * PAGE)
  const open = () =>
    createPageStreamer(pages, 'http://cache/', {
      cache,
      workerCount: 1,
      maxTransferBytes: TRANSFER,
    })
  const before = open()
  const retainBefore = retained(before, urls)
  retainBefore(urls)
  await before.request(urls, { signal: before.signal })
  assert.deepEqual(held(cache, urls), urls, 'all pinned: held past the budget')
  // The next session reads through the cache before the first one closes, and pins `b`. The first
  // lets `b` and `c` go: `b` stays, pinned by the next, and `c` leaves.
  const after = open()
  const retainAfter = retained(after, urls)
  retainAfter(['b.bin'])
  retainBefore(['a.bin'])
  assert.deepEqual(held(cache, urls), ['a.bin', 'b.bin'])
  before.dispose()
  retainAfter([])
  assert.deepEqual(held(cache, urls), ['a.bin', 'b.bin'])
  after.dispose()
})
