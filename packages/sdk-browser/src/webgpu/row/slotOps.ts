import type { createWebgpuRowWriters } from './writers.ts'
import type { createWebgpuRowClaims } from './claims.ts'
import type { PageRec } from '../../page/selection/types.ts'
import type { PageList } from '../../page/selection/catalogue.ts'
import { awaitsPageBytes } from './pageSlots.ts'
import type { WebgpuRowState } from './state.ts'
import type { createRowDemand } from './rowDemand.ts'
import type { RowWords } from './rowWords.ts'
import type { RowOrder } from './rowOrder.ts'

/** What the row cache's passes share (`slots.ts`): the table, the catalogue, the ranks freed, the
 *  claims, the rows' use, the cut's demand, the writers, and the counts of the pass. */
export type RowSlots = {
  rows: WebgpuRowState
  packedPages: PageList
  recordOf: (page: number) => PageRec | undefined
  drawsRow: (page: number) => boolean
  onResidenceChange: (rec: PageRec, page: number) => void
  /** Ranks this pass gave back, waiting for a taker or a fill: never more than the table holds. */
  free: { rows: Int32Array; count: number }
  /** Arrivals that claim a record and wait their turn, from one image to the next. */
  claims: ReturnType<typeof createWebgpuRowClaims>
  /** The rows' use words the GPU stamps (`rowWords.ts`), its queues (`rowOrder.ts`), its clock. */
  words: RowWords
  order: RowOrder
  frame: () => number
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
  const row = rows.rowOf(page)
  return (
    row >= 0 &&
    rows.rowOffsetWords[row] === rows.offsetOf(page) &&
    rows.rowEpoch[row] === rows.tableEpoch
  )
}

/** Residency flag of a page, and the candidate count: a transparent cluster draws in the blend
 *  pass, claims no visibility row and is not counted. Idempotent. */
function setResident(s: RowSlots, page: number, resident: boolean) {
  const { rows } = s
  const value = resident ? 1 : 0
  if (rows.residentFlag(page) === value) return
  const rec = s.recordOf(page)!
  rows.setResidentFlag(page, value)
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
  const row = rows.rowOf(page),
    offset = rows.offsetOf(page)
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
  const resident = rows.offsetOf(page) >= 0 && !awaitsPageBytes(rec)
  const wantsRow = resident && s.drawsRow(page)
  if (wantsRow) followPlace(s, page)
  setResident(s, page, resident && (!wantsRow || rowWritten(s, page)))
  if (wantsRow) return !rows.residentFlag(page)
  const row = rows.rowOf(page)
  if (row < 0) return false
  rows.setRowOf(page, -1)
  free.rows[free.count++] = row
  s.writers.state.changed = true
  return false
}

/** The row of the next page the GPU's queue gives up (`rowOrder.ts`), wherever it moved, its
 *  instance out of the cut's residency, or -1. */
function evictRow(s: RowSlots) {
  const page = s.order.victim()
  if (page === undefined) return -1
  const row = s.rows.rowOf(page)
  s.rows.setRowOf(page, -1)
  setResident(s, page, false)
  return row
}

/** Writes a page's record at its own rank, a freed one, the table's end or — asked for by the
 *  cut — a rank no cut used for a while; its flag rises after. False when no rank is left. */
export function placeRow(s: RowSlots, page: number) {
  const { rows, free } = s
  const own = rows.rowOf(page),
    asked = s.demand.wanted(page)
  let row = own
  if (row < 0)
    row = free.count ? free.rows[--free.count] : s.count < rows.blendFirst ? s.count++ : -1
  if (row < 0 && asked) row = evictRow(s)
  if (row < 0) return false
  s.writers.assign(row, page, rows.offsetOf(page))
  // A new occupant: used now when a request took it, the first to go when no cut asked for it.
  if (own < 0) s.words.assign(row, page, asked ? s.frame() : 0)
  else if (asked) s.words.stamp(row, s.frame())
  setResident(s, page, true)
  return true
}
