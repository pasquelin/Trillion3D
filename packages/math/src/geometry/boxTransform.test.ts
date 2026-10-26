// box.ts: the empty box and the in-place matrix transformation.
import test from 'node:test'
import assert from 'node:assert/strict'
import { boxEmpty, boxIsEmpty, boxTransform } from './box.ts'
import { assertBits } from '../../../../tests/kit/assert/bits.ts'

test('boxIsEmpty reports an inverted box, not a point box nor a NaN bound', () => {
  assert.equal(boxIsEmpty([1, 1, 1, 0, 0, 0], 0), true) // inverted
  assert.equal(boxIsEmpty([2, 3, 4, 2, 3, 4], 0), false) // point: equal bounds
  assert.equal(boxIsEmpty([NaN, 0, 0, 1, 1, 1], 0), false) // a NaN bound does not empty the box
  assert.equal(boxIsEmpty([0, 0, 0, 1, NaN, 1], 0), false)
})

test('boxTransform in place (out === box) yields same result as a fresh output', () => {
  const m = [2, 0, 0, 0, 0, -3, 0, 0, 0, 0, 0.5, 0, 1, 1, 1, 1] // scale (2, -3, 0.5), moved by (1, 1, 1)
  const b = [-1, -2, -3, 4, 5, 6]
  const fresh = new Float64Array(6)
  boxTransform(fresh, 0, b, 0, m)
  const inPlace = Float64Array.from(b)
  boxTransform(inPlace, 0, inPlace, 0, m)
  assertBits(inPlace, fresh)
})

test('boxTransform keeps an empty box unchanged, bounds included', () => {
  const blank = new Float64Array(6)
  boxEmpty(blank, 0)
  const before = Float64Array.from(blank)
  boxTransform(blank, 0, blank, 0, [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1])
  assertBits(blank, before)
})
