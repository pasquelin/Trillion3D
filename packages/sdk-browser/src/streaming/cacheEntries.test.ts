// The host caches' entries (`cacheEntries.ts`): least recently touched first, never a held one,
// without ever looking at one, the bytes and the held bytes as running totals.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCacheEntries } from './cacheEntries.ts'
import { random } from '../page/cut/cutRuleChecks.fixture.ts'

/** Entries whose value is their weight, and the keys each eviction takes. */
function entries() {
  const left: string[] = []
  const cache = createCacheEntries<number>((_, key) => void left.push(key))
  const put = (key: string, bytes: number) => cache.set(key, bytes, bytes)
  return { cache, put, left }
}

test('one eviction past P held entries checks over() twice and evicts the one victim, whatever P', () => {
  for (const held of [0, 1, 1000, 100_000]) {
    const { cache, put } = entries()
    for (let i = 0; i < held + 2; i++) put(`p${i}`, 1)
    for (let i = 0; i < held; i++) cache.acquire(`p${i}`)
    let checks = 0,
      left = 1
    const victims: string[] = []
    const over = () => {
      checks++
      return left > 0
    }
    const evicted = cache.evict(over, (key) => {
      left--
      victims.push(key)
    })
    assert.equal(evicted, 1)
    assert.deepEqual(victims, [`p${held}`], `the oldest entry not held, past ${held} held`)
    assert.equal(checks, 2, `one check per victim and one to stop, past ${held} held`)
    assert.equal(cache.heldBytes, held)
    if (held === 0) continue
    // The held state changes: the oldest entry is let go, the next victim held. The first is next.
    cache.release('p0')
    cache.acquire(`p${held + 1}`)
    checks = 0
    left = 2
    const second = cache.evict(over, (key) => {
      left--
      victims.push(key)
    })
    assert.equal(second, 1, 'the one entry let go, then nothing but held entries')
    assert.deepEqual(victims.slice(1), ['p0'])
    assert.equal(checks, 1, 'one check per victim; the heap is then empty: none per held entry')
    assert.equal(cache.heldBytes, held)
  }
})

test('random touches, drops, holds and evictions: the least recently touched entry not held leaves first', () => {
  for (const seed of [1, 7, 914, 2026]) {
    const draw = random(seed)
    const { cache, put, left } = entries()
    /** The model: the keys in recency order, their bytes, and how many hold each. */
    const order: string[] = [],
      bytes = new Map<string, number>(),
      holds = new Map<string, number>()
    const forget = (key: string) => {
      const at = order.indexOf(key)
      if (at >= 0) order.splice(at, 1)
      bytes.delete(key)
    }
    const keys = Array.from({ length: 48 }, (_, i) => `k${i}`)
    for (let step = 0; step < 4000; step++) {
      const key = keys[Math.floor(draw() * keys.length)],
        roll = draw()
      if (roll < 0.3) {
        const weight = 1 + Math.floor(draw() * 100)
        forget(key)
        order.push(key)
        bytes.set(key, weight)
        put(key, weight)
      } else if (roll < 0.4) {
        if (cache.touch(key) !== undefined) order.push(order.splice(order.indexOf(key), 1)[0])
      } else if (roll < 0.47) {
        forget(key)
        holds.delete(key)
        cache.drop(key)
      } else if (roll < 0.62) {
        holds.set(key, (holds.get(key) ?? 0) + 1)
        cache.acquire(key)
      } else if (roll < 0.77) {
        const own = holds.get(key) ?? 0
        if (own > 1) holds.set(key, own - 1)
        else holds.delete(key)
        cache.release(key)
      } else {
        const want = Math.floor(draw() * 6)
        const expected = order.filter((k) => !holds.has(k)).slice(0, want),
          got: string[] = []
        let room = want
        cache.evict(
          () => room > 0,
          (k) => {
            room--
            got.push(k)
          },
        )
        for (const k of got) forget(k)
        assert.deepEqual(got, expected, `seed ${seed}, step ${step}`)
      }
      let total = 0,
        held = 0
      for (const [k, weight] of bytes) {
        total += weight
        if (holds.has(k)) held += weight
      }
      assert.deepEqual(
        [cache.bytes, cache.heldBytes, cache.size],
        [total, held, bytes.size],
        `totals, seed ${seed}, step ${step}`,
      )
    }
    assert.ok(left.length > 0, 'each value that left was told')
  }
})

test('a key held before its value lands is out of reach once it lands; a drop takes its holds', () => {
  const { cache, put } = entries()
  cache.acquire('a') // pinned before it is read
  put('a', 8)
  put('b', 8)
  assert.equal(cache.heldBytes, 8)
  const victims: string[] = []
  cache.evict(
    () => true,
    (k) => void victims.push(k),
  )
  assert.deepEqual(victims, ['b'], 'the held entry stays')
  cache.drop('a')
  assert.deepEqual([cache.bytes, cache.heldBytes, cache.entry('a')], [0, 0, undefined])
  put('a', 4) // read again: nothing holds it any more
  cache.evict(
    () => true,
    (k) => void victims.push(k),
  )
  assert.deepEqual(victims, ['b', 'a'])
  cache.acquire('c')
  cache.release('c')
  assert.equal(cache.entry('c'), undefined, 'a hold on nothing that ends leaves nothing behind')
})

test('an eviction is asked with the oldest value it would take, and stops at the first refused', () => {
  const cache = createCacheEntries<string>()
  for (const key of ['a', 'b', 'c', 'd']) cache.set(key, key, 1)
  cache.acquire('b')
  const asked: string[] = [],
    victims: string[] = []
  cache.evict(
    (oldest) => (asked.push(oldest), oldest !== 'd'),
    (key) => void victims.push(key),
  )
  assert.deepEqual(
    [asked, victims],
    [
      ['a', 'c', 'd'],
      ['a', 'c'],
    ],
  )
})

test('a value touched again leaves last; touching the newest moves nothing', () => {
  const { cache, put } = entries()
  for (const key of ['a', 'b', 'c']) put(key, 1)
  cache.touch('a')
  cache.touch('a')
  cache.resize('c', 5)
  assert.deepEqual([cache.bytes, cache.size], [7, 3])
  const victims: string[] = []
  cache.evict(
    () => true,
    (k) => void victims.push(k),
  )
  assert.deepEqual(victims, ['b', 'c', 'a'])
})
