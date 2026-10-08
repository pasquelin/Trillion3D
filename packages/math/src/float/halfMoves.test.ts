// `fromHalf` writes a normal half's double as bits: all 65 536 words, the words past sixteen bits
// and the non-words a caller may pass keep the value of the product it computed before.
import assert from 'node:assert/strict'
import test from 'node:test'
import { fromHalf } from './half.ts'
import { fromHalfBefore } from './halfBefore.fixture.ts'

test('fromHalf: every word, and every input past them, decodes to the same bits', () => {
  const check = (bits: number) => {
    const old = fromHalfBefore(bits),
      now = fromHalf(bits)
    if (!Object.is(old, now)) assert.fail(`${bits}: old ${old}, new ${now}`)
  }
  for (let bits = 0; bits < 0x20000; bits++) check(bits)
  for (const bits of [-1, -0x8000, -0x7c00, 2 ** 31, 2 ** 32 - 1, 2 ** 32, 2 ** 40 + 0x3c00])
    check(bits)
  for (const bits of [-0, 0.5, 0x3c00 + 0.75, NaN, Infinity, -Infinity, 1e300]) check(bits)
})
