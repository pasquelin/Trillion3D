// #198, #1483: a row of the page table changes occupant. Under the row cache a row is EVICTED —
// the view moved to another placement, whose requests take back the rows no cut used for a while
// (`webgpu/row/rowUse.ts`). Every reader of a row must then follow its new occupant: its record
// names it, and the row is marked rewritten, the run the draw items, the corners and the
// partition's history are rewritten and forgotten on (`webgpu/row/dirty.ts`,
// `forEachRewrittenRun`; `webgpu/visibility/corners.ts`). On Dawn the shipped kernel cuts each view on the residency the cache publishes: the moved view draws what it wants,
// from its own placement alone, no evicted occupant in its place.
import test from 'node:test'
import assert from 'node:assert/strict'
import { forEachRewrittenRun } from '../../../packages/sdk-browser/src/webgpu/row/dirty.ts'
import { rowIdleSpan } from '../../../packages/sdk-browser/src/webgpu/row/rowCache.fixture.ts'
import { ROW_WORDS, rowCacheScene, settleView } from './rowCacheScene.ts'

/** Rows the table holds: far fewer than the placements' instances, more than one view asks. */
const TABLE = 512

test('a row evicted for another placement names its new occupant to every reader', async () => {
  const scene = rowCacheScene(64, TABLE)
  const { rows, base, pagesPer } = scene
  const first = await settleView(scene, 0)
  assert.deepEqual(first.drawn, first.wanted, 'the first view settles')
  const owners = Array.from(rows.rowPageIndex.subarray(0, rows.packedCount))
  rows.clearDirty()
  // The view moves three placements down: what it wants takes rows back from the cache.
  const moved = await settleView(scene, 3, 2 * rowIdleSpan())
  assert.ok(moved.wanted.length > 4, 'the moved view wants a cut of several pages')
  assert.deepEqual(moved.drawn, moved.wanted, 'every wanted page drawn, no ancestor in its place')
  const own = (page: number) => page >= base(3) && page < base(3) + pagesPer
  assert.ok(moved.drawn.every(own), 'drawn from the moved view’s placement alone')
  assert.ok(rows.packedCount <= TABLE, 'within the table')
  // Rows whose occupant changed: each names its new page, and is a rewritten run's.
  const changed = owners.flatMap((page, row) => (rows.rowPageIndex[row] !== page ? [row] : []))
  assert.ok(changed.length > 0, 'the moved view evicted rows')
  const rewritten = new Set<number>()
  forEachRewrittenRun(rows, owners.length, rewritten, (into, from, to) => {
    for (let row = from; row <= to; row++) into.add(row)
  })
  for (const row of changed) {
    const page = rows.rowPageIndex[row]
    assert.equal(
      rows.pageTableInts![row * ROW_WORDS],
      page + 1,
      `row ${row}'s record names ${page}`,
    )
    assert.equal(rows.rowOfPage[page], row, `${page} reads its row`)
    assert.ok(
      rewritten.has(row),
      `row ${row} is rewritten for the draw items, corners and partition`,
    )
  }
  // Every page the moved view draws holds a row whose record names it.
  for (const page of moved.drawn) {
    const row = rows.rowOfPage[page]
    assert.ok(
      row >= 0 && rows.pageTableInts![row * ROW_WORDS] === page + 1,
      `${page} holds its row`,
    )
  }
})
