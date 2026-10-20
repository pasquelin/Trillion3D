// The victim order of a pool keyed by number: its keys taken in the GPU's order, a key arrived
// since the cut never taken, and the denial rule a table grows by — an order spent whose total its
// victims took found nothing more, one whose total is larger only waits for the next.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSlotOrder } from './slotOrder.ts'

/** A pool of keys held at the arrival counts `held` gives, and its order. */
function pool(held: Map<number, number>) {
  return createSlotOrder((key) => held.get(key))
}

const queueOf = (keys: number[]) => Uint32Array.from(keys)

test('keys leave in the order listed; one gone or arrived since the cut is skipped', () => {
  const held = new Map([
    [10, 1],
    [11, 2],
    [12, 3],
  ])
  const order = pool(held)
  assert.equal(order.victim(), undefined, 'no order yet')
  order.follow(queueOf([12, 10, 11]), 3)
  held.delete(12)
  held.set(10, 4)
  assert.equal(order.victim(), 11)
  assert.equal(order.victim(), undefined)
})

test('an order spent with ranked keys left behind its burst waits; one whose total it took denies', () => {
  const held = new Map([
    [1, 0],
    [2, 0],
    [3, 0],
  ])
  const order = pool(held)
  assert.equal(order.exhausted(), false, 'no order: the request waits')
  order.follow(queueOf([1, 2]), 0, 5)
  assert.equal(order.victim(), 1)
  assert.equal(order.victim(), 2)
  assert.equal(order.victim(), undefined)
  assert.equal(order.exhausted(), false, 'three more ranked behind the burst: the next order')
  order.follow(queueOf([3]), 0, 1)
  assert.equal(order.exhausted(), false, 'one victim left')
  assert.equal(order.victim(), 3)
  assert.equal(order.exhausted(), true, 'every ranked key taken: nothing more to give')
})

test('a listed key that left is no victim taken: the request waits for the next order', () => {
  const held = new Map([[1, 0]])
  const order = pool(held)
  order.follow(queueOf([1]), 0, 1)
  held.delete(1)
  assert.equal(order.victim(), undefined)
  assert.equal(order.exhausted(), false)
})
