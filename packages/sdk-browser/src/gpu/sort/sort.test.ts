// The shipped pool sort (`sortWgsl.ts`, run by `shippedSort`) against the contract it serves, the
// pool's own (`sortPool`), over a pool many workgroups wide.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shippedSort, sortPool } from './sort.fixture.ts'
import { POOL_RANKS } from './rank.ts'

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
