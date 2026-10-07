import { createSparseInts, grown } from '../../page/cut/sparseInts.ts'
import type { FrameClock } from '../../page/integration/frameBudget.ts'
import type { RowUse } from './rowUse.ts'
import { serveInOrder } from './claims.ts'
import { createListDifference } from './listDifference.ts'
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
 *  the request each entered page came in by, and the bytes its tables hold. */
export type InstanceClosure = Pick<GroupClosure, 'apply' | 'delta' | 'enteredBy' | 'hostBytes'>

/** A refused request stops the serve: the table has no row for it, nor for any after it. */
const STOP = () => true

/** A page's mark: wanted — the requests' closure holds it and it draws from a row —, kept in the
 *  wanted set, listed in the demand at or past the rank the serve goes on from. */
const WANTED = 1,
  IN_SET = 2,
  LISTED = 4

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
 * full. One still waiting for its bytes stays wanted and takes its row when they land.
 *
 * Nothing is closed over again per readback: each list — drawn, asked, asked ahead — reaches the
 * demand as its difference (`listDifference.ts`), and two counted closures follow the differences
 * alone: the closure of every list holds the rows in use (a group-mate outside the view keeps a
 * drawn page ready), the closure of the requests the instances wanted — marked, resident or not,
 * with the request each came in by. The demand itself is derived again from those marks at each
 * readback, and whenever the table grows or is rebuilt: the requests in the GPU's order, the
 * camera's then the view ahead's, each followed by the wanted pages it brought, then the wanted
 * pages whose request left; of those, the ones the cut cannot read resident. So a page the serve
 * passed, let go and asked again, or one whose row a rebuild dropped, is asked again, and a nearer
 * request is never queued behind an older one. A page whose bytes land or move while wanted asks
 * again as the row journal names it (`touched`).
 *
 * Cost per readback adopted, for lists of D drawn, A asked and H ahead ids, W pages wanted, and
 * differences of ΔD, ΔA and ΔH: O(D + A + H) marks read, no record; O((ΔD + ΔA + ΔH)·g) closure,
 * g the pages a group holds; O(A + H + W) to derive the demand, marks and rows read; O(touched) per
 * sync for landings; O(wanted) served. A still camera adopts no readback and lands nothing: zero.
 */
export function createRowDemand(
  /** The row table, its arrays read at each readback: they are replaced as pages are added. */
  table: { readonly rowOfPage: Int32Array; readonly residentFlags: Uint32Array },
  use: RowUse,
  /** Whether a packed instance draws from a visibility row once resident: opaque, with geometry. */
  drawsRow: (page: number) => boolean,
  pageCount: number,
  /** A new counted closure over the instances, per placement. */
  closure: () => InstanceClosure,
) {
  const d: DemandState = {
    ...{ table, use, drawsRow },
    lists: {
      drawn: createListDifference(),
      asked: createListDifference(),
      ahead: createListDifference(),
    },
    held: closure(),
    asking: closure(),
    marks: new Uint8Array(Math.max(1, pageCount)),
    wanted: { pages: new Int32Array(8), by: new Int32Array(8), count: 0 },
    ranks: createSparseInts(),
    order: { ranked: new Int32Array(8), starts: new Int32Array(8), slots: new Int32Array(8) },
    list: new Int32Array(8),
    ...{ count: 0, next: 0, fresh: false, owed: false },
    rows: new Int32Array(0),
    flags: new Uint32Array(0),
  }
  return {
    /** The readback just adopted: its differences followed, the demand derived again. */
    follow: (cut: CutLists) => follow(d, cut),
    /** Pages whose bytes or slot moved (the row journal): a wanted page not ready asks again. */
    touched(pages: ArrayLike<number>, count: number) {
      readTable(d)
      for (let i = 0; i < count; i++) list(d, pages[i])
    },
    /** Whether the requests' closure holds `page` and the cut does not read it resident. */
    wanted: (page: number) => (d.marks[page] & WANTED) !== 0 && !resident(d.table, page),
    /** Whether a readback's closure holds `page`: its row is in use. */
    holds: (page: number) => d.held.delta.has(page),
    /** The demand derived again and served from its head: the table grew or was rebuilt. */
    restart: () => derive(d),
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
    /** Bytes of the marks, the wanted set, the order, the list, the differences and the closures. */
    get bytes() {
      const { drawn, asked, ahead } = d.lists,
        { wanted, order } = d
      return (
        d.marks.byteLength +
        wanted.pages.byteLength +
        wanted.by.byteLength +
        d.ranks.byteLength +
        order.ranked.byteLength +
        order.starts.byteLength +
        order.slots.byteLength +
        d.list.byteLength +
        drawn.bytes +
        asked.bytes +
        ahead.bytes +
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
  lists: Record<'drawn' | 'asked' | 'ahead', ReturnType<typeof createListDifference>>
  /** The closure of every list: the rows in use. */
  held: InstanceClosure
  /** The closure of the requests: the instances wanted. */
  asking: InstanceClosure
  /** `WANTED`, `IN_SET` and `LISTED` per instance. */
  marks: Uint8Array
  /** The wanted pages and the request each came in by; one let go stays until the next derive. */
  wanted: { pages: Int32Array; by: Int32Array; count: number }
  /** Each request's rank, one past it, while the demand is derived. */
  ranks: ReturnType<typeof createSparseInts>
  /** The requests by rank, then the wanted set's entries bucketed by their request's rank. */
  order: { ranked: Int32Array; starts: Int32Array; slots: Int32Array }
  list: Int32Array
  count: number
  next: number
  /** A readback was followed, or the table moved, since the demand was last served. */
  fresh: boolean
  /** The time budget stopped the last serve: the next image goes on. */
  owed: boolean
  rows: Int32Array
  flags: Uint32Array
}

/** Whether the cut reads `page` resident: a row, its record written. */
const resident = (t: DemandState['table'], page: number) =>
  t.rowOfPage[page] >= 0 && t.residentFlags[page] !== 0

function readTable(d: DemandState) {
  d.rows = d.table.rowOfPage
  d.flags = d.table.residentFlags
}

/** `page` behind the demand, when it is wanted, not listed past the serve's rank, and the cut does
 *  not read it resident — a row whose record is owed is asked as a missing one is. */
function list(d: DemandState, page: number) {
  const mark = d.marks[page]
  if ((mark & (WANTED | LISTED)) !== WANTED || (d.rows[page] >= 0 && d.flags[page])) return
  if (d.count === d.list.length) d.list = grown(d.list, d.count + 1, d.count)
  d.marks[page] = mark | LISTED
  d.list[d.count++] = page
  d.fresh = true
}

/** `page`, brought into the requests' closure by request `by`: wanted, in the set unless still
 *  there from before it was let go. */
function want(d: DemandState, page: number, by: number) {
  if (!d.drawsRow(page)) return
  if (page >= d.marks.length) d.marks = grown(d.marks, page + 1, d.marks.length)
  const mark = d.marks[page]
  d.marks[page] = mark | WANTED | IN_SET
  if (mark & IN_SET) return
  const set = d.wanted
  if (set.count === set.pages.length) {
    set.pages = grown(set.pages, set.count + 1, set.count)
    set.by = grown(set.by, set.count + 1, set.count)
  }
  set.pages[set.count] = page
  set.by[set.count++] = by
}

/** `delta` into the closure of every list: the rows of what it brings held, of what it lets go
 *  aging from this readback. */
function followUse(d: DemandState, delta: IdDelta) {
  d.held.apply(delta)
  const { entered, exited, enteredCount, exitedCount } = d.held.delta
  for (let i = 0; i < enteredCount; i++) {
    const row = d.rows[entered[i]] ?? -1
    if (row >= 0) d.use.hold(row)
  }
  for (let i = 0; i < exitedCount; i++) {
    const row = d.rows[exited[i]] ?? -1
    if (row >= 0) d.use.release(row)
  }
}

/** `delta` into the closure of the requests: what it brings wanted, what it lets go no longer. */
function followAsks(d: DemandState, delta: IdDelta) {
  d.asking.apply(delta)
  const { entered, exited, enteredCount, exitedCount } = d.asking.delta,
    by = d.asking.enteredBy
  for (let i = 0; i < enteredCount; i++) want(d, entered[i], by[i])
  for (let i = 0; i < exitedCount; i++)
    if (exited[i] < d.marks.length) d.marks[exited[i]] &= ~WANTED
}

const NONE: readonly number[] = []

function follow(d: DemandState, cut: CutLists) {
  readTable(d)
  d.use.tick()
  const { drawn, asked, ahead } = d.lists
  drawn.apply(cut.drawablePageIds ?? NONE)
  asked.apply(cut.pageIds)
  ahead.apply(cut.aheadPageIds ?? NONE)
  followUse(d, drawn.delta)
  followUse(d, asked.delta)
  followUse(d, ahead.delta)
  followAsks(d, asked.delta)
  followAsks(d, ahead.delta)
  derive(d)
}

/** The wanted set without the pages let go since the last derive. */
function compact(d: DemandState) {
  const set = d.wanted
  let kept = 0
  for (let i = 0; i < set.count; i++) {
    const page = set.pages[i]
    if (d.marks[page] & WANTED) {
      set.pages[kept] = page
      set.by[kept++] = set.by[i]
    } else d.marks[page] &= ~IN_SET
  }
  set.count = kept
}

/** Ranks the requests, camera's then ahead's, each once: `ranked` in order, `ranks` one past. */
function rankRequests(d: DemandState) {
  const { asked, ahead } = d.lists,
    o = d.order
  d.ranks.clear()
  const total = asked.count + ahead.count
  if (o.ranked.length < total) o.ranked = grown(o.ranked, total)
  let count = 0
  for (const l of [asked, ahead])
    for (let i = 0; i < l.count; i++) {
      const page = l.ids[i]
      if (d.ranks.get(page)) continue
      o.ranked[count++] = page
      d.ranks.set(page, count)
    }
  return count
}

/** The wanted set's entries bucketed by their request's rank (`starts`, `slots`): bucket `r` for
 *  the request ranked `r`, the last for a request no list names now. */
function bucket(d: DemandState, ranked: number) {
  const o = d.order,
    set = d.wanted,
    buckets = ranked + 2
  if (o.starts.length < buckets + 1) o.starts = grown(o.starts, buckets + 1)
  if (o.slots.length < set.count) o.slots = grown(o.slots, set.count)
  const { starts, slots } = o
  starts.fill(0, 0, buckets + 1)
  const keyOf = (i: number) => d.ranks.get(set.by[i]) || ranked + 1
  for (let i = 0; i < set.count; i++) starts[keyOf(i) + 1]++
  for (let k = 0; k < buckets; k++) starts[k + 1] += starts[k]
  for (let i = 0; i < set.count; i++) slots[starts[keyOf(i)]++] = i
  // Each bucket's start moved to the next one's: shifted back, `starts[k]` opens bucket `k`.
  for (let k = buckets; k > 0; k--) starts[k] = starts[k - 1]
  starts[0] = 0
}

/** The demand derived again from the marks, in the GPU's order, its serve from the head. */
function derive(d: DemandState) {
  readTable(d)
  for (let i = 0; i < d.count; i++) d.marks[d.list[i]] &= ~LISTED
  d.count = d.next = 0
  d.fresh = d.owed = false
  compact(d)
  const ranked = rankRequests(d)
  bucket(d, ranked)
  const { ranked: requests, starts, slots } = d.order,
    pages = d.wanted.pages
  for (let r = 1; r <= ranked + 1; r++) {
    if (r <= ranked) list(d, requests[r - 1])
    for (let k = starts[r]; k < starts[r + 1]; k++) list(d, pages[slots[k]])
  }
}

function serve(
  d: DemandState,
  release: (page: number) => boolean,
  place: (page: number) => boolean,
  budget: FrameClock | undefined,
) {
  d.fresh = d.owed = false
  // A page the serve passes leaves the list: let go, served, or waiting for its bytes, it is
  // listed again as its bytes land or the next readback derives the demand.
  const claims = (page: number) => {
    if ((d.marks[page] & WANTED) !== 0 && release(page)) return true
    d.marks[page] &= ~LISTED
    return false
  }
  const placed = (page: number) => {
    if (!place(page)) return false
    d.marks[page] &= ~LISTED
    return true
  }
  const at = serveInOrder(d.list, d.next, d.count, claims, placed, budget, STOP)
  if (at < 0) {
    d.next = ~at
    return d.count - d.next
  }
  d.next = at
  d.owed = d.next < d.count
  // Every request served or left for its bytes: the list starts again empty, the wanted kept.
  if (!d.owed) d.count = d.next = 0
  return 0
}
