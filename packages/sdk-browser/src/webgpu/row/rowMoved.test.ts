// #1483: a page whose bytes move in the pool keeps its row and its residency, and a page the cut
// needs that it cannot read resident — no row, or a row whose record is owed — is asked for.
import test from 'node:test'
import assert from 'node:assert/strict'
import { closeAlone, range, rowCache } from './rowCache.fixture.ts'
import { createRowDemand } from './rowDemand.ts'
import { createRowUse } from './rowUse.ts'
import { ROW_OFFSET_WORD } from './pageRow.ts'
import { PAGE_INFO_STRIDE } from '../../visibility/buffer.ts'

const WORDS = PAGE_INFO_STRIDE / 4

test('a full table whose pages move in the pool keeps them resident, rows at their place', () => {
  const cache = rowCache(3, 2),
    { rows } = cache
  cache.land([1, 2])
  cache.frame()
  assert.deepEqual(cache.held(), [1, 2])
  // A pool resized: both pages copied elsewhere, the table full.
  cache.land([1, 2], 48)
  cache.frame()
  assert.deepEqual(cache.held(), [1, 2])
  assert.deepEqual(Array.from(rows.residentFlags), [0, 1, 1], 'never out of residency for a move')
  const { pages, count } = rows.residencyChanges
  const announced = Array.from(pages.subarray(0, count))
  assert.deepEqual(announced, [1, 2], 'each move announced, its flag kept')
  for (const page of [1, 2]) {
    const row = rows.rowOfPage[page]
    assert.equal(rows.rowOffsetWords[row], page * 48)
    assert.equal(rows.pageTableInts![row * WORDS + ROW_OFFSET_WORD], page * 48)
  }
})

test('the demand asks for a page whose row the cut reads not resident, as for one without', () => {
  const table = { rowOfPage: Int32Array.of(0, -1, -1), residentFlags: new Uint32Array(3) }
  const demand = createRowDemand(table, createRowUse(1), () => true, 3, closeAlone)
  // Page 0 holds row 0, its record owed; page 1 holds none; page 2 is not asked.
  demand.follow({ pageIds: [0, 1] })
  assert.deepEqual(range(3).map(demand.wanted), [true, true, false])
  table.residentFlags[0] = 1
  demand.follow({ pageIds: [0, 1] })
  assert.deepEqual(range(3).map(demand.wanted), [false, true, false], 'resident, it is served')
})
