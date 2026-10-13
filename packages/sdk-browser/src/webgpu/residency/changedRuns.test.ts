// The one changed list: indices marked in any order, any number of times, reach no size given
// beforehand, and come out once each — as runs under its coalescer, or increasing for a writer
// that joins them by its records' bytes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createChangedRuns } from './ranges.ts'

test('marks need no size: each index once, taken increasing, the list then empty', () => {
  const changed = createChangedRuns()
  for (const index of [40, 3, 40, 2, 1 << 20, 3]) changed.mark(index)
  assert.equal(changed.count, 4)
  assert.deepEqual([...changed.take()], [2, 3, 40, 1 << 20])
  assert.equal(changed.count, 0)
  // The marks cleared by the take: an index taken is listed again when it changes again.
  changed.mark(40)
  assert.deepEqual([...changed.take()], [40])
})

test('runs join neighbours within the gap, every mark cleared after', () => {
  const changed = createChangedRuns(2)
  for (const index of [9, 1, 2, 4, 20, 21]) changed.mark(index)
  const { count, pairs } = changed.runs()
  assert.deepEqual([...pairs.subarray(0, count * 2)], [1, 4, 9, 9, 20, 21])
  changed.clear()
  changed.mark(4)
  assert.deepEqual([...changed.take()], [4])
})
