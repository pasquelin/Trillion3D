// The caches' entries (`cacheEntries.ts`) by tier: the upper tier leaves last.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCacheEntries } from './cacheEntries.ts'

test('a tier above leaves only once every entry below that may leave has, whatever the touches', () => {
  const cache = createCacheEntries<string>()
  cache.set('kept', 'kept', 1, 1)
  for (const key of ['a', 'b', 'c']) cache.set(key, key, 1)
  cache.acquire('b')
  cache.touch('a')
  const victims: string[] = []
  cache.evict(
    () => true,
    (key) => void victims.push(key),
  )
  assert.deepEqual(victims, ['c', 'a', 'kept'], 'the held entry stays, the upper tier leaves last')
})
