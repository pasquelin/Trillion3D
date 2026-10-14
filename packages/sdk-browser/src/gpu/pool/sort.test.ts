// The shipped pool sort (`sortWgsl.ts`, run by `shippedSort`) against the contracts it serves: the
// geometry queue's (`listEvictions`, `../dag/evict.fixture.ts`), its old head included, and the
// pool's own (`sortPool`) over a pool many workgroups wide.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shippedSort, sortPool } from './sort.fixture.ts'
import { poolRank } from './rank.fixture.ts'
import { EVICT_IN_USE, OLD_STEP, POOL_RANKS, POOL_TIERS } from './rank.ts'
import { listEvictions } from '../dag/evict.fixture.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'

test('the pool sort lists what the geometry queue lists, in its order, its old head included', () => {
  const next = lcgRandom(0x51),
    now = 400,
    keys = 3000,
    burst = 1024
  const keyWords = Uint32Array.from({ length: keys }, (_, k) => ((k % 7) << 27) | k)
  const uses = Uint32Array.from({ length: keys }, () => Math.floor(next() * now))
  const pool = Array.from({ length: keys }, (_, k) => k).filter(() => next() < 0.8)
  const ranks = pool.map((key) => poolRank(now - uses[key], keyWords[key] >>> 27, EVICT_IN_USE))
  const sorted = shippedSort(ranks, burst, 7)
  const contract = listEvictions({ pool, keyWords, useOf: (k) => uses[k], now, cap: burst })
  assert.deepEqual(
    sorted.queue.map((j) => pool[j]),
    contract.queue,
  )
  // The geometry's old head is the place word past the last young rank (`evictWgsl.ts`).
  assert.equal(Math.min(sorted.words[POOL_RANKS + OLD_STEP * POOL_TIERS - 1], burst), contract.old)
})

test('a pool past sixty-four workgroups: the burst holds the highest ranks, in slot order', () => {
  // More groups than the offsets' lanes, so a lane scans several; every rank hit, a slot in use one
  // in five, the ranks spread over all the workgroups.
  const slots = 256 * 300 + 37,
    burst = 1024
  const ranks = Array.from({ length: slots }, (_, j) =>
    j % 5 === 0 ? POOL_RANKS : ((j * 2654435761) % POOL_RANKS) >>> 0,
  )
  const sorted = shippedSort(ranks, burst, 11)
  const contract = sortPool(slots, (j) => ranks[j], burst)
  assert.equal(contract.queue.length, burst)
  assert.deepEqual(sorted.queue, contract.queue)
  assert.equal(sorted.placed, contract.total)
})
