// The one growth rule of a typed list: kept when it is long enough, else doubled at least, its
// entries kept and the rest filled; a list grown one entry at a time is copied log₂ n times.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resized } from './resized.ts'

test('a list long enough is kept; a short one grows twice at least, its entries kept', () => {
  const list = Int32Array.of(4, 5, 6)
  assert.equal(resized(list, 2), list)
  const next = resized(list, 4, -1)
  assert.deepEqual([...next], [4, 5, 6, -1, -1, -1])
  assert.ok(next instanceof Int32Array)
  assert.equal(resized(new Float64Array(2), 9).length, 9)
})

test('a list grown one entry at a time is copied a logarithmic number of times', () => {
  let list = new Uint32Array(1),
    copies = 0
  for (let count = 1; count < 1 << 16; count++) {
    const next = resized(list, count + 1)
    if (next !== list) copies++
    list = next
  }
  assert.equal(copies, 16)
})
