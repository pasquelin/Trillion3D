// #1483: the row table is a cache of what the GPU cut draws and asks for, bounded by the table,
// never by the placements; a request takes back a row no cut used for a while, never one in use.
import test from 'node:test'
import assert from 'node:assert/strict'
import { range, ROW_IDLE_READBACKS, rowCache } from './rowCache.fixture.ts'

test('a scene whose instances fit holds a row for every resident instance, as they land', () => {
  const cache = rowCache(6, 8)
  cache.land(range(6))
  cache.frame()
  assert.deepEqual(cache.held(), range(6))
  assert.deepEqual(Array.from(cache.rows.residentFlags), [1, 1, 1, 1, 1, 1])
})

test('past the table, a request takes the row no cut used, never one a recent cut used', () => {
  const cache = rowCache(8, 4),
    { rows } = cache
  cache.land(range(8))
  cache.frame()
  // The first four arrivals take the table; the others are resident bytes without a row.
  assert.deepEqual(cache.held(), [0, 1, 2, 3])
  assert.equal(rows.residentFlags[6], 0, 'without a row, the cut reads it as not resident')
  cache.readback([0, 1], [0, 1, 6])
  cache.frame()
  assert.deepEqual(cache.held(), [0, 1, 3, 6], 'the first unused row, page 2’s, serves page 6')
  assert.deepEqual([rows.residentFlags[2], rows.residentFlags[6]], [0, 1])
  cache.readback([0, 1, 6], [0, 1, 6, 7])
  cache.frame()
  assert.deepEqual(cache.held(), [0, 1, 6, 7])
  // Every row is in use: a request finds none, and is counted for the table to grow by.
  cache.readback([0, 1, 6, 7], [2])
  cache.frame()
  assert.deepEqual(cache.held(), [0, 1, 6, 7])
  assert.equal(rows.rowsDenied, 1)
})

test('a request the table refused takes a row once the table grows, without a new readback', () => {
  const cache = rowCache(3, 2),
    { rows } = cache
  cache.land(range(3))
  cache.frame()
  cache.readback([0, 1], [0, 1, 2])
  cache.frame()
  assert.equal(rows.rowsDenied, 1)
  rows.grow(3, 0)
  cache.frame()
  assert.deepEqual(cache.held(), [0, 1, 2])
  assert.equal(rows.rowsDenied, 0)
})

test('an instance asked for before its bytes land takes its row as they do, before any other', () => {
  const cache = rowCache(6, 3)
  cache.land(range(3))
  cache.frame()
  // Page 5 is asked for without its bytes; the rows of 0..2 go unused for the idle span.
  for (let k = 0; k <= ROW_IDLE_READBACKS; k++) cache.readback([], [5])
  cache.frame()
  assert.deepEqual(cache.held(), [0, 1, 2], 'nothing to place without bytes')
  // Pages 4 and 5 land together: 4 no cut asked for finds the table full, 5 takes a row back.
  cache.land([4, 5])
  cache.frame()
  assert.ok(cache.held().includes(5))
  assert.ok(!cache.held().includes(4))
  assert.equal(cache.rows.packedCount, 3)
})

test('the rows follow the view: a thousand placements ask no more rows than the cut uses', () => {
  const cache = rowCache(1000, 16),
    { rows } = cache
  cache.land(range(1000))
  cache.frame()
  assert.equal(rows.packedCount, 16, 'the table, not the placements, bounds the rows')
  // The view draws ten placements far down the catalogue: they take rows, the table stays whole.
  const seen = range(10, 990)
  cache.readback([], seen)
  cache.frame()
  for (const page of seen) assert.ok(rows.rowOfPage[page] >= 0, `${page} holds a row`)
  assert.equal(rows.packedCount, 16)
  assert.equal(rows.rowsDenied, 0)
  // Rows are dense: every rank of the table names the instance that holds it.
  for (let row = 0; row < rows.packedCount; row++)
    assert.equal(rows.rowOfPage[rows.packedPageIndex[row]], row)
})
