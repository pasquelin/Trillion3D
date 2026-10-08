import { createSparseInts } from '../../page/cut/sparseInts.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'
import type { FrameClock } from '../../page/integration/frameBudget.ts'
import type { RowUse } from './rowUse.ts'
import { serveInOrder } from './claims.ts'
import { createCutDelta } from '../cut/delta.ts'
import type { PageList } from '../pages/prepare/catalogue.ts'
import type { GroupClosure } from '../../page/cut/groupClosure.ts'
import type { IdDelta } from '../cut/delta.ts'

/** What a readback names, as packed instances: those its cut drew, and those it asks for — the
 *  camera's, then the view ahead's — in the order the GPU ranked them (`../../gpu/dag/request.ts`). */
export type CutLists = {
  readonly drawablePageIds?: ArrayLike<number>
  readonly pageIds: ArrayLike<number>
  readonly aheadPageIds?: ArrayLike<number>
}

/** A counted closure of differences, each placement's own packed ranks (`../../page/cut/groupClosure.ts`,
 *  `instances`): the pages a difference brings or lets go, groups and the groups above included,
 *  and the bytes its tables hold. */
export type InstanceClosure = Pick<GroupClosure, 'apply' | 'delta' | 'hostBytes'>

/** A refused request stops the serve: the table has no row for it, nor for any after it. */
const STOP = () => true

/**
 * THE GPU CUT'S DEMAND FOR ROWS (#1483). The cut reads an instance as resident only once its bytes
 * are AND it holds a row written at its place, so an instance whose bytes are in but which holds
 * no row is drawn by its nearest ready ancestor, and the cut ASKS for it, as for a page still on
 * its way: every readback lists the instances the view wants, ranked. Readiness is the group's,
 * closed upward (`../../page/cut/readiness.ts`): an instance draws once its group and the groups
 * above it are resident. So the demand is what the requests close over that draws from a row and
 * is not resident for the cut — no row, or one whose record is still owed: a missing ancestor is
 * asked as the leaf under it is, and no cut stays empty for it. The row allocator serves it before
 * any arrival (`slots.ts`), taking back a row unused for a while (`rowUse.ts`) when the table is
 * full. One still waiting for its bytes stays marked and takes its row when they land.
 *
 * Nothing is closed over again per readback: each list — drawn, asked, asked ahead — reaches the
 * demand as its difference (`../cut/delta.ts`), and two counted closures follow the differences
 * alone: the closure of every list holds the rows in use (a group-mate outside the view keeps a
 * drawn page ready), the closure of the requests the instances wanted. What a difference brings is
 * listed in the readback's order, each group-mate behind the request it came in with. A page whose
 * bytes land or leave while wanted is read again as the row journal names it (`touched`), and one
 * whose row a rebuild dropped as the rebuild names it (`../row/slotOps.ts`, `rebuildRows`).
 *
 * One live entry per page: the serve unlists every entry it passes — let go, served, or waiting
 * for its bytes, a page is listed again as it comes back, lands or loses its row, a group-mate with
 * the request it came in with (`waitingBy`) — and the passed entries are dropped, with those let
 * go or served since, once they are half the list, at a refusal and before a re-rank. Only when
 * the last serve left entries — the frame's budget spent, or a refused request at the head, the
 * table at its cap — is what is pending ranked again in the order of the readback just followed,
 * so a nearer new request never waits behind an older one. A refusal counts the live requests
 * without a row: what the table grows by.
 *
 * Cost per readback adopted, for lists of D drawn, A asked and H ahead ids, and differences of ΔD,
 * ΔA and ΔH: O(D + A + H) marks read, no record; O((ΔD + ΔA + ΔH)·g) closure, g the pages a group
 * holds; O(touched) per sync for landings; O(wanted) served, amortized; O(A + H + P log P) more for
 * the P live entries a serve left. A still camera adopts no readback and lands nothing: zero.
 */
export function createRowDemand(
  /** The row table, its arrays read at each readback: they are replaced as pages are added. */
  table: { readonly rowOfPage: Int32Array; readonly residentFlags: Uint32Array },
  use: RowUse,
  /** Whether a packed instance draws from a visibility row once resident: opaque, with geometry. */
  drawsRow: (page: number) => boolean,
  /** The packed instances the readbacks name. */
  packedPages: PageList,
  /** A new counted closure over the instances, per placement. */
  closure: () => InstanceClosure,
) {
  const d: DemandState = {
    ...{ table, use, drawsRow },
    lists: {
      drawn: createCutDelta(packedPages),
      asked: createCutDelta(packedPages),
      ahead: createCutDelta(packedPages),
    },
    held: closure(),
    asking: closure(),
    marks: new Uint8Array(Math.max(1, packedPages.length)),
    listed: new Uint8Array(Math.max(1, packedPages.length)),
    list: new Int32Array(8),
    by: new Int32Array(8),
    waitingBy: createSparseInts(),
    ranks: createSparseInts(),
    scratch: { keys: new Float64Array(0), pages: new Int32Array(0), by: new Int32Array(0) },
    ...{ count: 0, next: 0, fresh: false, owed: false },
    serving: { release: STOP, place: STOP, at: 0, claims: STOP, placed: STOP },
  }
  d.serving.claims = (page) => claimsAt(d, page)
  d.serving.placed = (page) => placedAt(d, page)
  return {
    /** The readback just adopted: its differences followed, its new demand behind the last. */
    follow: (cut: CutLists) => follow(d, cut),
    /** Pages whose bytes or slot moved (the row journal): a wanted page not ready asks again. */
    touched(pages: ArrayLike<number>, count: number) {
      for (let i = 0; i < count; i++) {
        const page = pages[i]
        if (!d.asking.delta.has(page)) continue
        // A group-mate the serve passed waiting for its bytes keeps its request's rank.
        const by = d.waitingBy.get(page)
        want(d, page, by ? by - 1 : page)
      }
    },
    /** Whether the requests' closure holds `page` and the cut does not read it resident. */
    wanted: (page: number) => d.marks[page] === 1 && !readsResident(d, page),
    /** Whether a readback's closure holds `page`: its row is in use. */
    holds: (page: number) => d.held.delta.has(page),
    /** The live demand is served again: the table grew or was rebuilt. */
    restart() {
      d.fresh = d.count > d.next
    },
    /** Something is left to serve this image. */
    get pending() {
      return d.fresh || d.owed
    },
    /** Instances asked for and not served yet. */
    get waiting() {
      return d.count - d.next
    },
    /**
     * Serves the demand in its order within `budget` (`serveInOrder`): `release` says whether the
     * instance still claims a record — resident, without a row written at its place —, `place`
     * writes it, at its own row or another, and returns
     * false when no row is free nor unused: the serve stops there. Returns how many requests the
     * table left without a row: what it grows by (`../pages/prepare/growTables.ts`).
     */
    serve: (
      release: (page: number) => boolean,
      place: (page: number) => boolean,
      budget?: FrameClock,
    ) => serve(d, release, place, budget),
    /** Bytes of the marks, the list, the differences and the closures. */
    get bytes() {
      const { drawn, asked, ahead } = d.lists
      return (
        d.marks.byteLength +
        d.listed.byteLength +
        d.list.byteLength +
        d.by.byteLength +
        d.waitingBy.byteLength +
        d.ranks.byteLength +
        d.scratch.keys.byteLength +
        d.scratch.pages.byteLength +
        d.scratch.by.byteLength +
        drawn.hostBytes +
        asked.hostBytes +
        ahead.hostBytes +
        d.held.hostBytes +
        d.asking.hostBytes
      )
    },
  }
}

type DemandState = {
  table: { readonly rowOfPage: Int32Array; readonly residentFlags: Uint32Array }
  use: RowUse
  drawsRow: (page: number) => boolean
  /** Each list's difference from the readback followed before. */
  lists: Record<'drawn' | 'asked' | 'ahead', ReturnType<typeof createCutDelta>>
  /** The closure of every list: the rows in use. */
  held: InstanceClosure
  /** The closure of the requests: the instances wanted. */
  asking: InstanceClosure
  /** 1 on a wanted instance; on one in `list`, 1 too in `listed`. */
  marks: Uint8Array
  listed: Uint8Array
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

/** Whether the cut reads `page` resident: a row of its own, and its bytes there. */
const readsResident = (d: DemandState, page: number) =>
  d.table.rowOfPage[page] >= 0 && d.table.residentFlags[page] > 0

/** `page`, wanted by the requests' closure: asked for unless the cut reads it resident — a row
 *  whose record is owed is asked as a missing one is —, behind the demand already listed, with the
 *  request `by` it came in with. */
function want(d: DemandState, page: number, by = page) {
  if (readsResident(d, page) || !d.drawsRow(page)) return
  if (page >= d.marks.length) {
    d.marks = resized(d.marks, page + 1)
    d.listed = resized(d.listed, page + 1)
  }
  d.marks[page] = 1
  if (d.listed[page]) return
  if (d.count === d.list.length) {
    d.list = resized(d.list, d.count + 1)
    d.by = resized(d.by, d.list.length)
  }
  d.listed[page] = 1
  if (d.waitingBy.size) d.waitingBy.set(page, 0)
  d.by[d.count] = by
  d.list[d.count++] = page
  d.fresh = true
}

/** `delta` into the closure of every list: the rows of what it brings held, of what it lets go
 *  aging from this readback. */
function followUse(d: DemandState, delta: IdDelta) {
  d.held.apply(delta)
  const { entered, exited, enteredCount, exitedCount } = d.held.delta
  for (let i = 0; i < enteredCount; i++) {
    const row = d.table.rowOfPage[entered[i]] ?? -1
    if (row >= 0) d.use.hold(row)
  }
  for (let i = 0; i < exitedCount; i++) {
    const row = d.table.rowOfPage[exited[i]] ?? -1
    if (row >= 0) d.use.release(row)
  }
}

/** Whether the readback just followed asks for `page` itself: a request, not a group-mate. */
const isRequest = (d: DemandState, page: number) =>
  d.lists.asked.has(page) || d.lists.ahead.has(page)

/** `delta` into the closure of the requests: what it brings wanted, in its order, each group-mate
 *  with the request before it — the first one after when none is —; what it lets go no longer. */
function followAsks(d: DemandState, delta: IdDelta) {
  d.asking.apply(delta)
  const { entered, exited, enteredCount, exitedCount } = d.asking.delta
  let by = -1
  for (let i = 0; i < enteredCount && by < 0; i++) if (isRequest(d, entered[i])) by = entered[i]
  for (let i = 0; i < enteredCount; i++) {
    const page = entered[i]
    if (isRequest(d, page)) by = page
    want(d, page, by < 0 ? page : by)
  }
  for (let i = 0; i < exitedCount; i++) {
    const page = exited[i]
    if (page < d.marks.length) d.marks[page] = 0
    if (d.waitingBy.size) d.waitingBy.set(page, 0)
  }
}

/** The entries from `next` that are live — wanted, the cut not reading them resident — moved to the
 *  head, the others unlisted; returns how many of them hold no row: the requests a refusal leaves. */
function compact(d: DemandState) {
  let kept = 0,
    rowless = 0
  for (let i = d.next; i < d.count; i++) {
    const page = d.list[i]
    if (d.marks[page] !== 1 || readsResident(d, page)) {
      d.listed[page] = 0
      continue
    }
    if (d.table.rowOfPage[page] < 0) rowless++
    d.by[kept] = d.by[i]
    d.list[kept++] = page
  }
  d.count = kept
  d.next = 0
  return rowless
}

/** The ranks of list `l`'s requests not ranked yet, after `rank`; the last given. */
function rankList(d: DemandState, l: DemandState['lists']['asked'], rank: number) {
  for (let i = 0; i < l.count; i++) if (!d.ranks.get(l.ids[i])) d.ranks.set(l.ids[i], ++rank)
  return rank
}

/** The pending entries, compacted, ranked again by the readback's order of the request each came
 *  in with, the camera's then the view ahead's; one whose request left after them; each run in its
 *  order. One key per entry — its rank times the count, plus its place — sorted as numbers. */
function rerank(d: DemandState) {
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

const NONE: readonly number[] = []

function follow(d: DemandState, cut: CutLists) {
  // Entries the last serve left: what this readback asks is ranked with them.
  const behind = d.count > d.next
  d.use.tick()
  const { drawn, asked, ahead } = d.lists
  drawn.apply(cut.drawablePageIds ?? NONE)
  asked.apply(cut.pageIds)
  ahead.apply(cut.aheadPageIds ?? NONE)
  followUse(d, drawn)
  followUse(d, asked)
  followUse(d, ahead)
  followAsks(d, asked)
  followAsks(d, ahead)
  // The budget or a refusal stopped the last serve: what is pending is ranked again, and served
  // again, this readback perhaps letting rows go.
  if (behind) {
    compact(d)
    rerank(d)
    d.fresh = d.count > 0
  }
}

/** Whether entry `page`, the next the serve asks, still claims a record (`release`); one it
 *  passes leaves the list, waiting for its bytes with its request kept when they are not there. */
function claimsAt(d: DemandState, page: number) {
  const by = d.by[d.serving.at++]
  if (d.marks[page] !== 1) {
    d.listed[page] = 0
    return false
  }
  if (d.serving.release(page)) return true
  d.listed[page] = 0
  if (!readsResident(d, page)) d.waitingBy.set(page, by + 1)
  return false
}

/** Entry `page` written at a row (`place`): it leaves the list. */
function placedAt(d: DemandState, page: number) {
  if (!d.serving.place(page)) return false
  d.listed[page] = 0
  return true
}

function serve(
  d: DemandState,
  release: (page: number) => boolean,
  place: (page: number) => boolean,
  budget: FrameClock | undefined,
) {
  d.fresh = d.owed = false
  // An entry the serve passes leaves the list: one the requests let go, served, or waiting for its
  // bytes — its request kept — is listed again as it comes back, lands or loses its row. The serve
  // asks each entry once, in order: `at` follows it.
  const s = d.serving
  s.release = release
  s.place = place
  s.at = d.next
  const stop = serveInOrder(d.list, d.next, d.count, s.claims, s.placed, budget, STOP)
  if (stop < 0) {
    d.next = ~stop
    return compact(d)
  }
  d.next = stop
  d.owed = d.next < d.count
  // Every request served or left for its bytes: the list starts again empty, the wanted kept.
  if (!d.owed) d.count = d.next = 0
  else if (d.next * 2 >= d.count) compact(d)
  return 0
}
