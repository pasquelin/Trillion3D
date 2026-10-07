import { sortPages } from '../../../../sdk-core/src/index.ts'
import { closeHoles, type createWebgpuRowWriters } from './writers.ts'
import { serveClaims, type createWebgpuRowClaims } from './claims.ts'
import type { PageRec } from '../../page/selection/selection.ts'
import type { PageList } from '../pages/prepare/catalogue.ts'
import { awaitsPageBytes } from './pageSlots.ts'
import type { createWebgpuRowState } from './state.ts'
import type { FrameClock } from '../../page/integration/frameBudget.ts'
import type { createRowUse } from './rowUse.ts'
import type { createRowDemand } from './rowDemand.ts'

/** What the row cache's passes share (`slots.ts`): the table, the catalogue, the ranks freed, the
 *  claims, the rows' use, the cut's demand, the writers, and the counts of the pass. */
export type RowSlots = {
  rows: ReturnType<typeof createWebgpuRowState>
  packedPages: PageList
  recordOf: (page: number) => PageRec | undefined
  drawsRow: (page: number) => boolean
  onResidenceChange: (rec: PageRec, page: number) => void
  /** Ranks this pass gave back, waiting for a taker or a fill: never more than the table holds. */
  free: { rows: Int32Array; count: number }
  /** Arrivals that claim a record and wait their turn, from one image to the next. */
  claims: ReturnType<typeof createWebgpuRowClaims>
  use: ReturnType<typeof createRowUse>
  demand: ReturnType<typeof createRowDemand>
  writers: ReturnType<typeof createWebgpuRowWriters>
  count: number
  candidates: number
  denied: number
  /** `releaseRow` and `placeRow` over this cache, made once: the callbacks a pass hands on. */
  release: (page: number) => boolean
  place: (page: number) => boolean
}

/** True when a page's rank really carries its current place in the cache. */
function rowWritten({ rows }: RowSlots, page: number) {
  const row = rows.rowOfPage[page]
  return (
    row >= 0 &&
    rows.rowOffsetWords[row] === rows.residentOffsetWords[page] &&
    rows.rowEpoch[row] === rows.tableEpoch
  )
}

/** Residency flag of a page, and the candidate count: a transparent cluster draws in the blend
 *  pass, claims no visibility row and is not counted. Idempotent. */
function setResident(s: RowSlots, page: number, resident: boolean) {
  const { rows } = s
  const value = resident ? 1 : 0
  if (rows.residentFlags[page] === value) return
  const rec = s.recordOf(page)!
  rows.residentFlags[page] = value
  rows.noteResidencyChange(page)
  s.onResidenceChange(rec, page)
  if (!rec.transparent) s.candidates += resident ? 1 : -1
}

/** A page holding a row written at this table's age whose bytes moved in the pool (a resize, a
 *  slot taken elsewhere): its row follows its place at once, so it never leaves residency for a
 *  move — the root cover above all, which no ancestor could draw for it (#1483). The move is
 *  still announced as the residency change it is, its flag kept: the GPU cut rereads the page's
 *  range and the image its resources. */
function followPlace(s: RowSlots, page: number) {
  const { rows, writers } = s
  const row = rows.rowOfPage[page],
    offset = rows.residentOffsetWords[page]
  if (row < 0 || rows.rowEpoch[row] !== rows.tableEpoch || rows.rowOffsetWords[row] === offset)
    return
  writers.replace(row, page, offset)
  rows.noteResidencyChange(page)
  s.onResidenceChange(s.recordOf(page)!, page)
}

/** Re-reads what the cache did with a page and takes back the rank it no longer deserves; true
 *  when it claims a record write: resident, drawing from a row, its rank not yet its place. */
export function releaseRow(s: RowSlots, page: number) {
  const { rows, free } = s
  const rec = s.recordOf(page)!
  const resident = rows.residentOffsetWords[page] >= 0 && !awaitsPageBytes(rec)
  const wantsRow = resident && s.drawsRow(page)
  if (wantsRow) followPlace(s, page)
  setResident(s, page, resident && (!wantsRow || rowWritten(s, page)))
  if (wantsRow) return !rows.residentFlags[page]
  const row = rows.rowOfPage[page]
  if (row < 0) return false
  rows.rowOfPage[page] = -1
  free.rows[free.count++] = row
  s.use.forget(row)
  s.writers.state.changed = true
  return false
}

/** The row the clock hand finds unused, its instance out of the cut's residency, or -1. */
function evictRow(s: RowSlots) {
  const row = s.use.victim(s.count)
  if (row < 0) return -1
  const page = s.rows.packedPageIndex[row]
  s.rows.rowOfPage[page] = -1
  setResident(s, page, false)
  return row
}

/** Writes a page's record at its own rank, a freed one, the table's end or — asked for by the
 *  cut — a rank no cut used for a while; its flag rises after. False when no rank is left. */
export function placeRow(s: RowSlots, page: number) {
  const { rows, free } = s
  const own = rows.rowOfPage[page],
    asked = s.demand.wanted(page)
  let row = own
  if (row < 0)
    row = free.count ? free.rows[--free.count] : s.count < rows.blendFirst ? s.count++ : -1
  if (row < 0 && asked) row = evictRow(s)
  if (row < 0) return false
  s.writers.assign(row, page, rows.residentOffsetWords[page])
  if (asked) s.use.stamp(row)
  else if (own < 0) s.use.idle(row)
  setResident(s, page, true)
  return true
}

/** The end of the table fills ranks no page took back, each row's use moving with it. */
export function closeFreeRows(s: RowSlots) {
  const move = (from: number, to: number) => (s.use.moved(from, to), s.writers.moveRow(from, to))
  s.count = closeHoles(s.free, s.count, move)
}

/** The table rebuilt from the catalogue, once: a new table (prepare, a lost visibility path). */
export function rebuildRows(s: RowSlots) {
  const { rows } = s
  rows.rowOfPage.fill(-1)
  s.count = 0
  s.free.count = 0
  s.use.reset()
  s.writers.state.changed = true
  s.claims.clear()
  // Every resident instance while the table has room, in catalogue order: `place` cannot refuse
  // below its end. An instance neither in the pool nor flagged has nothing to release: two
  // words read, not its record.
  const { residentOffsetWords, residentFlags } = rows
  for (let page = 0; page < s.packedPages.length && s.count < rows.blendFirst; page++)
    if ((residentOffsetWords[page] >= 0 || residentFlags[page]) && s.release(page)) s.place(page)
  s.demand.restart()
}

/** Every live row written again at its rank: the table's age moved (a pose, a surface). */
export function rewriteRows(s: RowSlots) {
  const { rows } = s
  for (let row = 0; row < s.count; row++) {
    const page = rows.packedPageIndex[row]
    // Its own row: `place` cannot refuse it.
    if (rows.rowOfPage[page] === row && s.release(page)) s.place(page)
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
    if (rows.rowOfPage[page] >= 0 || demand.wanted(page) || room) claims.add(page)
  }
  // No rank left: an arrival no cut asked for waits for none; one asked for counts as denied.
  const refused = (page: number) => void (demand.wanted(page) && s.denied++)
  serveClaims(claims, s.release, s.place, budget, refused)
}
