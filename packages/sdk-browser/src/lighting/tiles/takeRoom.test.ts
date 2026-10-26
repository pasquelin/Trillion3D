// Between its two walks, a column of the light grid takes its room in the view's pool. A
// column no light meets takes none and keeps its cells' start in the pool, count 0: an empty list.
// A column past the pool keeps the lights it got, cell after cell, and drops the rest; no cell is
// ever left to walk every light (`TILE_NO_SLICE`). The shipped `roomBefore`, `takeRoom` and `dealRoom` are
// run, lane by lane (`gridColumn.fixture.ts`), not a copy of them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/scene/light/contracts.ts'
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

test('a column with lights takes its room slice by slice; one past the pool keeps what is left', () => {
  const counts = new Array<number>(GRID_SLICES).fill(0)
  counts[3] = 2
  counts[7] = 5 | TILE_SHADOWED
  const kept = takeRoom(counts, 40, 100)
  assert.equal(kept.pool.head, 47)
  assert.equal(kept.cursor[3], 1040)
  assert.equal(kept.cursor[7], 1042)
  assert.equal(kept.cursor[8], 1047)
  assert.equal(kept.room, 1)
  // Four words left of seven: the first cell keeps its two, the second two of its five.
  const part = takeRoom(counts, 96, 100)
  assert.equal(part.pool.overflow, 1)
  assert.ok(part.cursor.every((at) => at !== TILE_NO_SLICE))
  assert.deepEqual(
    [part.counts[3], part.counts[7], part.counts[8]],
    [2, (2 | TILE_SHADOWED) >>> 0, 0],
  )
  assert.deepEqual([part.cursor[3], part.cursor[7], part.cursor[8]], [1096, 1098, 1100])
  assert.equal(part.room, 1)
  const full = takeRoom(counts, 100, 100)
  assert.equal(full.pool.overflow, 1)
  assert.ok(full.cursor.every((at) => at !== TILE_NO_SLICE))
  assert.deepEqual([full.counts[3], full.counts[7]], [0, TILE_SHADOWED >>> 0])
  assert.equal(full.room, 0)
})
