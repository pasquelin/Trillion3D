import assert from 'node:assert/strict'
import { test } from 'node:test'
import { uint64FromWords } from './uint64.ts'
import { uint64Words } from './uint64.fixture.ts'

test('two u32 words read as the integer they hold', () => {
  assert.equal(uint64FromWords(0, 0), 0)
  assert.equal(uint64FromWords(0xffffffff, 0), 4294967295)
  assert.equal(uint64FromWords(0, 1), 4294967296)
  assert.equal(uint64FromWords(5, 3), 12884901893)
  assert.equal(uint64FromWords(0xffffffff, 0x1fffff), Number.MAX_SAFE_INTEGER)
})

test('an integer below 2^53 splits into words that read back to it', () => {
  assert.deepEqual(uint64Words(12884901893), [5, 3])
  for (const value of [0, 1, 2 ** 32 - 1, 2 ** 32, 2 ** 32 + 1, 866 * 2 ** 20, 2 ** 53 - 1]) {
    const [low, high] = uint64Words(value)
    assert.ok(low >= 0 && low < 2 ** 32 && Number.isInteger(low) && Number.isInteger(high))
    assert.equal(uint64FromWords(low, high), value)
  }
})
