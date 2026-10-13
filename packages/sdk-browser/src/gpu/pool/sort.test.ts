// The pool sort's mirror (`sort.fixture.ts`) against the geometry queue's own (`listEvictions`,
// `../dag/evict.fixture.ts`), and over a pool many workgroups wide.
import test from 'node:test'
import assert from 'node:assert/strict'
import { sortPool } from './sort.fixture.ts'
import { poolRank } from './rank.fixture.ts'
import { EVICT_IN_USE, OLD_STEP, POOL_RANKS, POOL_TIERS } from './rank.ts'
import { listEvictions } from '../dag/evict.fixture.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'

test('the pool sort lists what the geometry queue lists, in its order, its old head included', () => {
  const next = lcgRandom(0x51),
    now = 400,
    keys = 3000
  const keyWords = Uint32Array.from({ length: keys }, (_, k) => ((k % 7) << 27) | k)
  const uses = Uint32Array.from({ length: keys }, () => Math.floor(next() * now))
  const pool = Array.from({ length: keys }, (_, k) => k).filter(() => next() < 0.8)
  const rankOf = (j: number) =>
    poolRank(now - uses[pool[j]], keyWords[pool[j]] >>> 27, EVICT_IN_USE)
  const sorted = sortPool(pool.length, rankOf, 1024)
  const queue = sorted.queue.map((j) => pool[j])
  const mirror = listEvictions({ pool, keyWords, useOf: (k) => uses[k], now, cap: 1024 })
  assert.deepEqual(queue, mirror.queue)
  assert.equal(Math.min(sorted.places[OLD_STEP * POOL_TIERS - 1], 1024), mirror.old)
})

test('a pool of a million slots over four thousand workgroups: the burst holds the highest ranks', () => {
  const slots = 256 * 1024 * 4 + 37,
    burst = 1024
  // Every rank is hit, a slot in use one in five: ranks spread over all the workgroups.
  const rankOf = (j: number) => (j % 5 === 0 ? POOL_RANKS : ((j * 2654435761) % POOL_RANKS) >>> 0)
  const { queue, total } = sortPool(slots, rankOf, burst)
  assert.equal(queue.length, burst)
  assert.equal(new Set(queue).size, burst)
  for (let i = 1; i < queue.length; i++)
    assert.ok(rankOf(queue[i - 1]) >= rankOf(queue[i]), `rank order at ${i}`)
  // Nothing left out ranks above the queue's last entry.
  const listed = new Set(queue),
    floor = rankOf(queue[queue.length - 1])
  let ranked = 0
  for (let j = 0; j < slots; j++) {
    const rank = rankOf(j)
    if (rank >= POOL_RANKS) continue
    ranked++
    if (!listed.has(j)) assert.ok(rank <= floor, `slot ${j} of rank ${rank} left out`)
  }
  assert.equal(total, ranked)
})
