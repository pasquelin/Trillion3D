// bits.ts: a set at an offset of a larger table, a flipped bit, and the walk of a word's set bits.
import test from 'node:test'
import assert from 'node:assert/strict'
import { flipBit, hasBit, lowestBit, setBit } from './bits.ts'

test('setBit, flipBit and hasBit at word base: the words before it untouched', () => {
  const words = new Uint32Array(4)
  setBit(words, 33, 2)
  assert.deepEqual([...words], [0, 0, 0, 2])
  assert.ok(hasBit(words, 33, 2) && !hasBit(words, 33))
  flipBit(words, 33, 2)
  flipBit(words, 31, 1)
  assert.deepEqual([...words], [0, 2 ** 31, 0, 0])
})

test('lowestBit walks every set bit of a word, the top one included, lowest first', () => {
  const seen: number[] = []
  for (let bits = (1 << 31) | (1 << 7) | 1; bits; bits &= bits - 1) seen.push(lowestBit(bits))
  assert.deepEqual(seen, [0, 7, 31])
})
