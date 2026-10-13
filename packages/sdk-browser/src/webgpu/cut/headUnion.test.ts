// A truncated list is read as its head, then what the list held past it: the head's marks follow
// the head, so a page id at 10⁹ costs a mark, not a table up to it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHeadUnion } from './headUnion.ts'

test('the head first, then the held pages it does not name, in held order, at a 10⁹ id', () => {
  const union = createHeadUnion(),
    far = 1e9
  assert.deepEqual([...union([far, 5, 5], [7, 5, far, 2], 4)], [far, 5, 5, 7, 2])
  // The marks of one list do not reach the next.
  assert.deepEqual([...union([7], [far, 7, 5], 3)], [7, far, 5])
})
