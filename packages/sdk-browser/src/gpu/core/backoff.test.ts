// The one backoff of the retries (`backoff.ts`): it doubles from its base up to its cap, spread by a quarter either way, never past the cap.
import test from 'node:test'
import assert from 'node:assert/strict'
import { JITTER, MAX_RETRY_MS, RETRY_MS, backoffMs } from './backoff.ts'

test('the wait doubles at each refusal in a row up to the cap, at the middle of its spread', () => {
  assert.equal(backoffMs(1, 0.5), RETRY_MS)
  assert.equal(backoffMs(2, 0.5), 2 * RETRY_MS)
  assert.equal(backoffMs(3, 0.5), 4 * RETRY_MS)
  assert.equal(backoffMs(7, 0.5), MAX_RETRY_MS)
  assert.equal(backoffMs(40, 0.5), MAX_RETRY_MS, 'the wait stops doubling')
})

test('the wait is spread by a quarter either way, and never past the cap', () => {
  assert.equal(backoffMs(1, 0), RETRY_MS * (1 - JITTER))
  assert.equal(backoffMs(1, 1), RETRY_MS * (1 + JITTER))
  assert.equal(backoffMs(7, 1), MAX_RETRY_MS, 'the cap holds')
  assert.equal(backoffMs(7, 0), MAX_RETRY_MS * (1 - JITTER))
  const seeded = [0.1, 0.9, 0.4]
  const waits = seeded.map((random) => backoffMs(3, random))
  assert.equal(new Set(waits).size, 3, 'the refusals of one moment do not wait alike')
  for (const wait of waits) assert.ok(wait >= 4 * RETRY_MS * 0.75 && wait <= 4 * RETRY_MS * 1.25)
})

test('the random is drawn when none is given', () => {
  const wait = backoffMs(1)
  assert.ok(wait >= RETRY_MS * 0.75 && wait <= RETRY_MS * 1.25)
})
