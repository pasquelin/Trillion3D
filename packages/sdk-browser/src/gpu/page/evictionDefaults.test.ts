// An order that says nothing of its OLD head nor of the cut the frames draw — a tile pool's, which
// no view ahead asks of — is taken whole and always open: every key it lists may leave, for a lower
// arrival too. Fails on the old taker: each such pool spelt `old: count` and `open: () => true`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createEviction } from './eviction.ts'

test('an order without its old head nor its open rule is taken whole, always open', () => {
  const held = new Map([1, 2, 3].map((key) => [key, { generation: 0 }]))
  const eviction = createEviction<number, { generation: number }>(held)
  eviction.follow({ count: 3, arrivals: 0, keyAt: (at) => at + 1 })
  assert.equal(eviction.victims(true), 3, 'every key old')
  assert.equal(eviction.evictable(3, true), true)
  assert.equal(eviction.victim(undefined, true), held.get(1))
})
