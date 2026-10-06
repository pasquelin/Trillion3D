import test from 'node:test'
import assert from 'node:assert/strict'
import { createAutonomousResidency } from './residency.ts'
import { createStreamingCache } from '../../streaming/cache.ts'
import type { StreamContext } from '../../streaming/types.ts'

test('WebGL reuses exited ranks after the streamer consumes them', () => {
  const modifiedPages = new Set<string>()
  const residency = createAutonomousResidency({
    bootstrapUrls: new Set(['root']),
    modifiedPages,
    views: [{ shown: [], requested: [] }],
    geometryStore: {} as never,
  })
  const pinned = new Set<string>()
  const urls = Array.from({ length: 40 }, (_, i) => `mounted-${i}`)
  const catalog = new Map(
    ['root', ...urls].map((url) => [url, { url, bytes: 1, sha256: '' }] as const),
  )
  const cache = createStreamingCache(
    {
      store: { budgetBytes: Infinity, bytes: 0, holds: () => false },
      cache: new Map(),
      state: {},
      maxPages: undefined,
      pinned,
      jobs: new Map(),
      emit: () => {},
      catalog,
    } as unknown as StreamContext,
    () => 0,
  )
  const retain = () => {
    residency.keptChanged()
    const delta = residency.retainedRanks()
    cache.retainRanks(delta)
    assert.ok(delta.urls.length <= 2, 'rank table is bounded by the live pins')
    return delta
  }
  for (const url of urls) {
    modifiedPages.add(url)
    retain()
    assert.deepEqual(pinned, new Set(['root', url]))
    modifiedPages.delete(url)
    retain()
    assert.deepEqual(pinned, new Set(['root']))
    assert.equal(residency.retainedRanks().exitedCount, 0, 'held read clears the delta')
  }
  modifiedPages.add(urls[0])
  retain()
  assert.deepEqual(pinned, new Set(['root', urls[0]]), 'a removed URL can re-enter')
})
