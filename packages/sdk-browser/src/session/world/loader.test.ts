// A manifest a world loads is read once (`worldModelLoader`): a load naming it again — at the same
// address, however written — waits for that read and places its model again (`placeModel`,
// `models/modelJoin.test.ts`). Oracle: the reads `fetch` was asked for.
import test from 'node:test'
import assert from 'node:assert/strict'
import { worldModelLoader } from './loader.ts'
import { createPageCache } from '../../geometry/streaming/pageCache.ts'

test('a manifest loaded again is read once, and each load places its model again', async () => {
  const asked: string[] = []
  const original = globalThis.fetch
  // Every read is refused after it is counted: the first load fails, and a failed read is asked
  // again by the next load, never handed to it.
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    asked.push(String(input))
    throw new Error('offline')
  }) as typeof fetch
  try {
    const url = 'http://cache.test/emerald/manifest.json'
    // What one load reads, retries included (`checked`).
    await worldModelLoader(Promise.resolve(), undefined, createPageCache())(url, {}).catch(() => {})
    const once = asked.length
    asked.length = 0
    const load = worldModelLoader(Promise.resolve(), undefined, createPageCache())
    const results = await Promise.allSettled([load(url, {}), load(url, {})])
    assert.deepEqual(
      results.map((r) => r.status),
      ['rejected', 'rejected'],
    )
    assert.ok(once > 0)
    assert.equal(asked.length, once, 'two loads in flight read the manifest once')
    await load('http://cache.test/emerald/./manifest.json', {}).catch(() => {})
    assert.equal(asked.length, 2 * once, 'a failed read is asked again, under the same address')
  } finally {
    globalThis.fetch = original
  }
})
