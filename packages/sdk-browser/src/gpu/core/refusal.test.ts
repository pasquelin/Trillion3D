// The one refusal record (`refusal.ts`): a budget refusal waits for its room, a device refusal for
// a wait that doubles in a row, never every frame, never never.
import test from 'node:test'
import assert from 'node:assert/strict'
import { budgetRefusal, deviceRefusal, retryDue, retryFrame } from './refusal.ts'

test('a budget refusal comes back once the room holds what it measured, whatever the frame', () => {
  const refusal = budgetRefusal(1000, 5)
  assert.equal(retryDue(refusal, 999, 1e9), false)
  assert.equal(retryDue(refusal, 1000, 6), true)
  assert.equal(retryFrame(refusal), Infinity)
})

test('a device refusal comes back after a wait twice the last, up to its cap', () => {
  const first = deviceRefusal(0)
  assert.equal(retryFrame(first), 300)
  assert.equal(retryDue(first, Number.MAX_SAFE_INTEGER, 299), false, 'no room brings it back')
  assert.equal(retryDue(first, 0, 300), true)
  const second = deviceRefusal(300, first)
  assert.equal(retryFrame(second), 900)
  let last = second
  for (let i = 0; i < 20; i++) last = deviceRefusal(0, last)
  assert.equal(last.wait, 300 * 64, 'the wait stops doubling')
  assert.equal(deviceRefusal(0, budgetRefusal(10, 0)).wait, 300, 'a budget refusal before it')
})
