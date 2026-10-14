import { sortPages } from '../../../../sdk-core/src/index.ts'
import { closeHoles } from './writers.ts'
import { serveClaims } from './claims.ts'
import type { FrameClock } from '../../page/integration/frameBudget.ts'
import type { RowSlots } from './slotOps.ts'

// The row cache's passes over the whole table (`slots.ts`), each page through the per-page steps
// its callbacks hold (`slotOps.ts`, `releaseRow`, `placeRow`): the holes filled from the end, the
// table rebuilt or written again, the arrivals followed.

/** The end of the table fills ranks no page took back, each row's use moving with it: used now
 *  on the GPU's words, a move never shortening its protection. */
export function closeFreeRows(s: RowSlots) {
  const move = (from: number, to: number) => (
    s.use.moved(from, to),
    s.words.moved(from, to, s.frame()),
    s.writers.moveRow(from, to)
  )
  s.count = closeHoles(s.free, s.count, move)
}

/** The table rebuilt from the catalogue, once: a new table (prepare, a lost visibility path). A
 *  page that held a row and holds none after is named to the demand: asked for, it asks again. */
export function rebuildRows(s: RowSlots) {
  const { rows } = s
  const held = heldPages(s)
  rows.clearRows()
  s.count = 0
  s.free.count = 0
  s.use.reset()
  // The pages the GPU's queue names took no row of this table: none is its victim.
  s.order.reset()
  s.writers.state.changed = true
  s.claims.clear()
  // Every resident instance while the table has room, in catalogue order: `place` cannot refuse
  // below its end. An instance neither in the pool nor flagged has nothing to release: two
  // words read, not its record.
  for (let page = 0; page < s.packedPages.length && s.count < rows.blendFirst; page++)
    if ((rows.offsetOf(page) >= 0 || rows.residentFlag(page)) && s.release(page)) s.place(page)
  let dropped = 0
  for (const page of held) if (rows.rowOf(page) < 0) held[dropped++] = page
  s.demand.touched(held, dropped)
  s.demand.restart()
}

/** The pages holding a row of the table, each once: what a rebuild may drop. */
function heldPages({ rows, count }: RowSlots) {
  const pages = new Int32Array(count)
  let n = 0
  for (let row = 0; row < count; row++) {
    const page = rows.packedPageIndex[row]
    if (rows.rowOf(page) === row) pages[n++] = page
  }
  return pages.subarray(0, n)
}

/** Every live row written again at its rank: the table's age moved (a pose, a surface). */
export function rewriteRows(s: RowSlots) {
  const { rows } = s
  for (let row = 0; row < s.count; row++) {
    const page = rows.packedPageIndex[row]
    // Its own row: `place` cannot refuse it.
    if (rows.rowOf(page) === row && s.release(page)) s.place(page)
  }
}

/** Arrivals, in catalogue order: while the table has room, or the cut asked for them. A page that
 *  holds its row takes no other: its record is owed at its own rank, whatever room is left. */
export function followArrivals(s: RowSlots, budget?: FrameClock) {
  const { rows, claims, demand, free } = s
  sortPages(rows.touched.pages, rows.touched.count)
  for (let i = 0; i < rows.touched.count; i++) {
    const page = rows.touched.pages[i]
    if (!s.release(page)) continue
    const room = s.count - free.count + claims.count < rows.blendFirst
    if (rows.rowOf(page) >= 0 || demand.wanted(page) || room) claims.add(page)
  }
  // No rank left: an arrival no cut asked for waits for none; one asked for counts as denied when
  // the GPU's queue has nothing more to give (`rowOrder.ts`), else it waits for the next.
  const refused = (page: number) =>
    void (demand.wanted(page) && s.order.denies(s.frame()) && s.denied++)
  serveClaims(claims, s.release, s.place, budget, refused)
}
