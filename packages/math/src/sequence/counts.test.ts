// A refcount by key: what reaches zero or below leaves.
import test from 'node:test'
import assert from 'node:assert/strict'
import { countBy } from './counts.ts'

test('a count reaching zero or below leaves the map', () => {
  const counts = new Map<string, number>()
  assert.equal(countBy(counts, 'a', 1), 1)
  assert.equal(countBy(counts, 'a', 1), 2)
  assert.equal(countBy(counts, 'a', -2), 0)
  assert.equal(counts.has('a'), false)
  assert.equal(countBy(counts, 'b', -1), -1)
  assert.equal(counts.has('b'), false)
})
