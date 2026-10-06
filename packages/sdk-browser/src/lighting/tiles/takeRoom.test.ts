// #1369: between its two walks, a column of the light grid takes its room in the view's pool. A
// column no light meets takes none and keeps its cells' start in the pool, count 0: an empty list.
// Its start must never be `TILE_NO_SLICE`, which the resolve reads as a pool with no room left and
// walks every light of the scene there. The shipped `roomBefore`, `takeRoom` and `dealRoom` are
// run, lane by lane (`gridColumn.fixture.ts`), not a copy of them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts'
import { GRID_SLICES, TILE_NO_SLICE, TILE_SHADOWED, columnRoom } from './gridColumn.fixture.ts'

/** One column's room on slice counts `counts`, against a pool at `head` of `capacity`. */
function takeRoom(counts: number[], head: number, capacity: number) {
  const pool = { start: 1000, capacity, head, overflow: 0 }
  return { ...columnRoom(counts, pool), pool }
}

test('a column no light meets takes no room and keeps an empty list, never every light', () => {
  assert.equal(GRID_SLICES, LIGHT_SETTINGS.gridSlices)
  const { cursor, pool, room } = takeRoom(new Array(GRID_SLICES).fill(0), 40, 100)
  assert.deepEqual(pool, { start: 1000, capacity: 100, head: 40, overflow: 0 })
  assert.ok(cursor.every((at) => at !== TILE_NO_SLICE))
  assert.equal(room, 0, 'no list to write')
})

test('a column with lights takes its room slice by slice; one past the pool walks every light', () => {
  const counts = new Array<number>(GRID_SLICES).fill(0)
  counts[3] = 2
  counts[7] = 5 | TILE_SHADOWED
  const kept = takeRoom(counts, 40, 100)
  assert.equal(kept.pool.head, 47)
  assert.equal(kept.cursor[3], 1040)
  assert.equal(kept.cursor[7], 1042)
  assert.equal(kept.cursor[8], 1047)
  assert.equal(kept.room, 1)
  const full = takeRoom(counts, 96, 100)
  assert.equal(full.pool.overflow, 1)
  assert.ok(full.cursor.every((at) => at === TILE_NO_SLICE))
  assert.equal(full.room, 0)
})
