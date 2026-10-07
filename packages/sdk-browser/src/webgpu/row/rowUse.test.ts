// #1483: the rows in use are counted by the readback that stamped them, so a full table under a
// turning camera answers "no row unused" without sweeping it; the count follows rows given back,
// moved and taken again.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRowUse } from './rowUse.ts'
import { rowIdleSpan } from './rowCache.fixture.ts'
import { DAG_READBACK_SLOTS } from '../../gpu/dag/layout.ts'

test('a table whose rows are all in use has no victim until a row goes unused', () => {
  const use = createRowUse(4)
  use.tick()
  for (const row of [0, 1, 2, 3]) use.stamp(row)
  assert.equal(use.victim(4), -1, 'every row stamped by the last readback')
  // Readbacks that name every row but 2, until a request may take a row back.
  let span = 0,
    victim = -1
  while (victim < 0 && span < 1 << 16) {
    use.tick()
    for (const row of [0, 1, 3]) use.stamp(row)
    victim = use.victim(4)
    span++
  }
  assert.equal(victim, 2, 'row 2, unused for the whole span')
  assert.equal(span, rowIdleSpan(), 'a full table and a lone row wait the same span')
  // The readbacks in flight and the image being encoded may still draw it: never taken before.
  assert.ok(span > DAG_READBACK_SLOTS + 1, `span ${span}`)
})

test('rows given back and moved keep the count of the rows in use', () => {
  const use = createRowUse(4)
  use.tick()
  for (const row of [0, 1, 2, 3]) use.stamp(row)
  // Row 1 is given back and the end row fills its rank: three live rows, all in use.
  use.forget(1)
  use.moved(3, 1)
  assert.equal(use.victim(3), -1)
  // An arrival's row is the first a request takes back.
  use.idle(2)
  assert.equal(use.victim(3), 2)
  use.reset()
  assert.equal(use.victim(3), 0, 'a new table: every row unused')
})
