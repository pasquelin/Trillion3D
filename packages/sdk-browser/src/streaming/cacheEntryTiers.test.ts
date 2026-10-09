// The caches' entries (`cacheEntries.ts`) by tier and by lane: the upper tier leaves last, and each
// lane is its own heap.
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

test('each lane is its own heap: one lane alone gives up its first, every lane in one order', () => {
  const cache = createCacheEntries<string>(undefined, (value) => Number(value.startsWith('p')))
  for (const key of ['l1', 'p1', 'l2', 'p2']) cache.set(key, key, 1)
  const victims: string[] = []
  const told = (key: string) => void victims.push(key)
  cache.evict(() => victims.length < 1, told, 1)
  assert.deepEqual(victims, ['p1'], 'the older entry of another lane stays')
  // A value set again in another lane leaves that lane's heap.
  cache.set('l2', 'p3', 1)
  cache.evict(() => true, told)
  assert.deepEqual(victims, ['p1', 'l1', 'p2', 'l2'])
})
