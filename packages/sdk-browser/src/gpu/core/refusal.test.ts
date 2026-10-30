// The one refusal record (`refusal.ts`): a budget refusal waits for its room, a device refusal for
// a wait that doubles in a row, never every frame, never never.
import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_RETRY_MS, RETRY_MS } from './backoff.ts'
import { budgetRefusal, deviceRefusal, deviceWaiting, retryAt, retryDue } from './refusal.ts'

/** No spread: the middle of the backoff's. */
const MIDDLE = 0.5

test('a budget refusal comes back once the room holds what it measured, whatever the time', () => {
  const refusal = budgetRefusal(1000, 5)
  assert.equal(retryDue(refusal, 999, 1e12), false)
  assert.equal(retryDue(refusal, 1000, 6), true)
  assert.equal(retryAt(refusal), Infinity)
})

test('a device refusal comes back after a wait twice the last, up to its cap', () => {
  const first = deviceRefusal(0, undefined, MIDDLE)
  assert.equal(retryAt(first), RETRY_MS)
  assert.equal(
    retryDue(first, Number.MAX_SAFE_INTEGER, RETRY_MS - 1),
    false,
    'no room brings it back',
  )
  assert.equal(retryDue(first, 0, RETRY_MS), true)
  const second = deviceRefusal(RETRY_MS, first, MIDDLE)
  assert.equal(retryAt(second), 3 * RETRY_MS)
  let last = second
  for (let i = 0; i < 20; i++) last = deviceRefusal(0, last, MIDDLE)
  assert.equal(last.wait, MAX_RETRY_MS, 'the wait stops doubling')
  assert.equal(
    deviceRefusal(0, budgetRefusal(10, 0), MIDDLE).wait,
    RETRY_MS,
    'a budget refusal before it',
  )
})

test('refusals of one moment do not come back together: the wait is spread', () => {
  const waits = [0, 0.3, 0.6, 1].map((random) => deviceRefusal(0, undefined, random).wait)
  assert.equal(new Set(waits).size, 4)
  for (const wait of waits) assert.ok(wait >= RETRY_MS * 0.75 && wait <= RETRY_MS * 1.25)
})

test('only a device refusal waits on time, until its wait ends', () => {
  assert.equal(deviceWaiting(budgetRefusal(10, 0), 1), false, 'a budget refusal waits for room')
  const refusal = deviceRefusal(0, undefined, MIDDLE)
  assert.equal(deviceWaiting(refusal, RETRY_MS - 1), true)
  assert.equal(deviceWaiting(refusal, RETRY_MS), false)
})
