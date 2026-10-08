import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mipSize, nextPow2, uniqueSortedInPlace } from './integers.ts'
import { setBit, testBit } from './bits.fixture.ts'
import { firstTrue, lastTrue } from './search.ts'

test('nextPow2 is exact on its whole domain: each power, either side of it, and reals', () => {
  for (let k = 1; k <= 32; k++) {
    const p = 2 ** k
    assert.equal(nextPow2(p), p, `2^${k}`)
    assert.equal(nextPow2(p - 1), k === 1 ? 1 : p, `2^${k} − 1`)
    assert.equal(nextPow2(p / 2 + 1), p, `2^${k - 1} + 1`)
    assert.equal(nextPow2(p - 0.5), p, `2^${k} − 0.5`)
    assert.equal(nextPow2(p / 2 + 2 ** -20), p, `just past 2^${k - 1}`)
  }
  // The logarithm form rounded 2^31 + 1 and 2^32 − 1 to their power of two below.
  assert.equal(nextPow2(2 ** 32 - 1), 2 ** 32)
  assert.equal(nextPow2(2 ** 31 + 1), 2 ** 32)
  assert.equal(nextPow2(1 + 2 ** -52), 2)
})

test('setBit and testBit: each bit alone, the top bit of a word, and the signed read', () => {
  const words = new Uint32Array(3)
  for (const i of [0, 31, 32, 63, 70]) setBit(words, i)
  assert.deepEqual([...words], [0x80000001, 0x80000001, 1 << 6])
  for (let i = 0; i < 96; i++) {
    const set = [0, 31, 32, 63, 70].includes(i) ? 1 : 0
    assert.equal(testBit(words, i), set, `${i}`)
    // The signed form a word read through `>>` gives: the same bit.
    assert.equal((words[i >> 5] >> (i & 31)) & 1, set, `${i}`)
  }
})

test('nextPow2 outside its domain: 1 up to 1, NaN for NaN, a throw past 2^32', () => {
  for (const v of [-Infinity, -5, -0, 0, 2 ** -1074, 0.5, 1]) assert.equal(nextPow2(v), 1, `${v}`)
  assert.ok(Number.isNaN(nextPow2(NaN)))
  for (const v of [2 ** 32 + 1, 2 ** 50 + 1, Infinity]) assert.throws(() => nextPow2(v), RangeError)
})

test('lastTrue and firstTrue: the searches they replace, every edge and empty range', () => {
  const oldLast = (low: number, high: number, holds: (i: number) => boolean) => {
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (holds(mid)) low = mid
      else high = mid - 1
    }
    return low
  }
  const oldFirst = (low: number, high: number, holds: (i: number) => boolean) => {
    while (low < high) {
      const mid = (low + high) >> 1
      if (holds(mid)) high = mid
      else low = mid + 1
    }
    return low
  }
  for (let low = 0; low <= 6; low++)
    for (let high = low - 2; high <= 14; high++)
      for (let edge = low - 1; edge <= high + 1; edge++) {
        const label = `[${low}, ${high}] edge ${edge}`
        assert.equal(
          lastTrue(low, high, (i) => i <= edge),
          oldLast(low, high, (i) => i <= edge),
          label,
        )
        assert.equal(
          firstTrue(low, high, (i) => i >= edge),
          oldFirst(low, high, (i) => i >= edge),
          label,
        )
      }
  // Past 2^31 the shift wraps; the division does not.
  assert.equal(
    lastTrue(0, 2 ** 32, (i) => i <= 2 ** 32 - 5),
    2 ** 32 - 5,
  )
  assert.equal(
    firstTrue(0, 2 ** 32, (i) => i >= 2 ** 31 + 7),
    2 ** 31 + 7,
  )
})

test('uniqueSortedInPlace: sorted, each value once in front, the array cut and the typed tail kept', () => {
  const list = [5, 1, 5, 3, 1, 9, 3]
  assert.equal(uniqueSortedInPlace(list), 4)
  assert.deepEqual(list, [1, 3, 5, 9])
  const typed = Int32Array.of(7, -2, 7, 0, -2)
  assert.equal(uniqueSortedInPlace(typed), 3)
  assert.deepEqual([...typed.subarray(0, 3)], [-2, 0, 7])
  assert.equal(typed.length, 5)
  const empty: number[] = []
  assert.equal(uniqueSortedInPlace(empty), 0)
  assert.equal(uniqueSortedInPlace(new Uint32Array(0)), 0)
  // Numeric, not by string: 10 after 9.
  const words = Uint32Array.of(10, 9, 2 ** 32 - 1, 9)
  assert.equal(uniqueSortedInPlace(words), 3)
  assert.deepEqual([...words.subarray(0, 3)], [9, 10, 2 ** 32 - 1])
})

test('mipSize halves by integer division, one texel at least, as `Math.max(1, size >> level)`', () => {
  for (const size of [1, 2, 3, 5, 255, 1000, 4096, 2 ** 30, 2 ** 31 - 1]) {
    for (let level = 0; level < 32; level++) {
      assert.equal(mipSize(size, level), Math.max(1, size >> level), `${size} >> ${level}`)
    }
  }
  assert.equal(mipSize(1000, 40), 1)
})
