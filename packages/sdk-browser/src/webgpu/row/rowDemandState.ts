import type { createSparseInts } from '../../page/cut/sparseInts.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'
import type { GroupClosure } from '../../page/cut/groupClosure.ts'
import type { CutDelta } from '../cut/delta.ts'

/** A counted closure of differences, each placement's own packed ranks (`../../page/cut/groupClosure.ts`,
 *  `instances`): the pages a difference brings or lets go, groups and the groups above included,
 *  and the bytes its tables hold. */
export type InstanceClosure = Pick<GroupClosure, 'apply' | 'delta' | 'hostBytes'>

/** What the demand reads of the row table: whether a page holds a row, and whether the cut reads it
 *  resident — read per page entering the requests and per pending entry, off the sparse maps
 *  (`pageState.ts`). */
type DemandTable = {
  hasRow(page: number): boolean
  /** Whether the cut reads `page` resident: a row of its own, and its bytes there. */
  readsResident(page: number): boolean
}

/** The row demand's state (`rowDemand.ts`): its table, its lists, the requests' closure, the marks
 *  and the list it serves. */
export type DemandState = {
  table: DemandTable
  drawsRow: (page: number) => boolean
  /** Each request list's difference from the readback followed before. */
  lists: Record<'asked' | 'ahead', CutDelta>
  /** The closure of the requests: the instances wanted. */
  asking: InstanceClosure
  /** Per instance, `WANTED` while the requests' closure holds it, `LISTED` while it is in `list`:
   *  held in a sparse map (`../../page/cut/sparseInts.ts`) for the flagged instances alone, so a
   *  page id of 10⁹ costs an entry, never a table up to it. */
  marks: ReturnType<typeof createSparseInts>
  list: Int32Array
  /** Per entry of `list`, the request it came in with: itself, or the one its group-mate asked. */
  by: Int32Array
  /** A wanted page the serve passed waiting for its bytes, and its request, one past it. */
  waitingBy: ReturnType<typeof createSparseInts>
  /** Each request's rank, one past it, while the pending list is ranked again. */
  ranks: ReturnType<typeof createSparseInts>
  /** The re-rank's keys and copies, kept from one to the next. */
  scratch: { keys: Float64Array; pages: Int32Array; by: Int32Array }
  count: number
  next: number
  /** A readback was followed, or the table moved, since the demand was last served. */
  fresh: boolean
  /** The time budget stopped the last serve: the next image goes on. */
  owed: boolean
  /** The serve's callers and its place in the list, and the two tests it runs, made once. */
  serving: {
    release: (page: number) => boolean
    place: (page: number) => boolean
    at: number
    claims: (page: number) => boolean
    placed: (page: number) => boolean
  }
}

/** An instance's demand flags (`DemandState.marks`). */
const WANTED = 1
export const LISTED = 2

/** Instance `page`'s demand flag `bit` set or cleared: a page with no flag left holds no entry. */
export function mark(d: DemandState, page: number, bit: number, on: boolean) {
  const was = d.marks.get(page)
  d.marks.set(page, on ? was | bit : was & ~bit)
}

/** `page` enters or leaves the requests' closure. */
export const markWanted = (d: DemandState, page: number, on: boolean) => mark(d, page, WANTED, on)

/** Whether the requests' closure holds `page`. */
export const isWanted = (d: DemandState, page: number) => (d.marks.get(page) & WANTED) !== 0

/** `page`, wanted by the requests' closure: asked for unless the cut reads it resident — a row
 *  whose record is owed is asked as a missing one is —, behind the demand already listed, with the
 *  request `by` it came in with. */
export function want(d: DemandState, page: number, by = page) {
  if (d.table.readsResident(page) || !d.drawsRow(page)) return
  markWanted(d, page, true)
  if (d.marks.get(page) & LISTED) return
  if (d.count === d.list.length) {
    d.list = resized(d.list, d.count + 1)
    d.by = resized(d.by, d.list.length)
  }
  mark(d, page, LISTED, true)
  if (d.waitingBy.size) d.waitingBy.set(page, 0)
  d.by[d.count] = by
  d.list[d.count++] = page
  d.fresh = true
}

/** The entries from `next` that are live — wanted, the cut not reading them resident — moved to the
 *  head, the others unlisted; returns how many of them hold no row: the requests a refusal leaves. */
export function compact(d: DemandState) {
  let kept = 0,
    rowless = 0
  for (let i = d.next; i < d.count; i++) {
    const page = d.list[i]
    if (!isWanted(d, page) || d.table.readsResident(page)) {
      mark(d, page, LISTED, false)
      continue
    }
    if (!d.table.hasRow(page)) rowless++
    d.by[kept] = d.by[i]
    d.list[kept++] = page
  }
  d.count = kept
  d.next = 0
  return rowless
}

/** The ranks of list `l`'s requests not ranked yet, after `rank`; the last given. */
function rankList(d: DemandState, l: CutDelta, rank: number) {
  for (let i = 0; i < l.count; i++) if (!d.ranks.get(l.ids[i])) d.ranks.set(l.ids[i], ++rank)
  return rank
}

/** The pending entries, compacted, ranked again by the readback's order of the request each came
 *  in with, the camera's then the view ahead's; one whose request left after them; each run in its
 *  order. One key per entry — its rank times the count, plus its place — sorted as numbers. */
export function rerank(d: DemandState) {
  const { asked, ahead } = d.lists,
    sc = d.scratch,
    n = d.count
  d.ranks.clear()
  let rank = 0
  rank = rankList(d, asked, rank)
  rank = rankList(d, ahead, rank)
  sc.keys = resized(sc.keys, n)
  sc.pages = resized(sc.pages, n)
  sc.by = resized(sc.by, n)
  for (let k = 0; k < n; k++) sc.keys[k] = (d.ranks.get(d.by[k]) || rank + 1) * n + k
  const keys = sc.keys.subarray(0, n).sort()
  sc.pages.set(d.list.subarray(0, n))
  sc.by.set(d.by.subarray(0, n))
  for (let k = 0; k < n; k++) {
    const from = keys[k] % n
    d.list[k] = sc.pages[from]
    d.by[k] = sc.by[from]
  }
  d.ranks.clear()
}
