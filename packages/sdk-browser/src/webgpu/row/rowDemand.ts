import { grown } from '../../page/cut/sparseInts.ts'
import type { FrameClock } from '../../page/integration/frameBudget.ts'
import type { RowUse } from './rowUse.ts'
import { serveInOrder } from './claims.ts'
import { createListDifference } from './listDifference.ts'
import type { GroupClosure } from '../../page/cut/groupClosure.ts'
import type { CutDelta, IdDelta } from '../cut/delta.ts'

/** What a readback names, as packed instances: those its cut drew, and those it asks for — the
 *  camera's, then the view ahead's — in the order the GPU ranked them (`../../gpu/dag/request.ts`). */
export type CutLists = {
  readonly drawablePageIds?: ArrayLike<number>
  readonly pageIds: ArrayLike<number>
  readonly aheadPageIds?: ArrayLike<number>
}

/** The differences a view's adoption publishes (`../cut/publication.ts`): the drawn row cache
 *  follows every one as it is applied, and reads a view's lists whole as it starts following it. */
export type ViewDifferences = { readonly asked: CutDelta; readonly drawn: CutDelta }

/** A counted closure of differences, each placement's own packed ranks (`../../page/cut/groupClosure.ts`,
 *  `instances`): the pages a difference brings or lets go, groups and the groups above included. */
export type InstanceClosure = Pick<GroupClosure, 'apply' | 'delta'>

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
 * demand as its difference: the view's own, which the GPU took, as each is applied
 * (`ViewDifferences`, `watch`) — a view's lists whole as the cache starts following it —, and the
 * requests ahead by their marks (`listDifference.ts`). Two counted closures follow the differences
 * alone: the closure of every list holds the rows in use (a group-mate outside the view keeps a
 * drawn page ready), the closure of the requests the instances wanted. A page whose bytes land or
 * leave while wanted is read again as the row journal names it (`touched`).
 *
 * Cost per readback adopted, for H requests ahead and differences of ΔD, ΔA and ΔH: O(ΔD + ΔA) set
 * moves and O(H) marks, no record; O((ΔD + ΔA + ΔH)·g) closure, g the pages a group holds;
 * O(touched) per sync for landings; O(wanted) served. A still camera adopts no readback and lands
 * nothing: zero. A view the cache starts following reads its lists once: O(D + A).
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
    following: { view: undefined, stop: () => {} },
    held: closure(),
    asking: closure(),
    marks: new Uint8Array(Math.max(1, pageCount)),
    listed: new Uint8Array(Math.max(1, pageCount)),
    list: new Int32Array(8),
    ...{ count: 0, next: 0, fresh: false, owed: false },
    rows: new Int32Array(0),
    flags: new Uint32Array(0),
  }
  return {
    /** The readback just adopted, by `view`'s differences when it published them: its differences
     *  followed, its new demand behind the last. */
    follow: (cut: CutLists, view?: ViewDifferences) => follow(d, cut, view),
    /** Pages whose bytes or slot moved (the row journal): a wanted page not ready asks again. */
    touched(pages: ArrayLike<number>, count: number) {
      d.rows = d.table.rowOfPage
      d.flags = d.table.residentFlags
      for (let i = 0; i < count; i++) if (d.asking.delta.has(pages[i])) want(d, pages[i])
    },
    /** Whether the requests' closure holds `page` and the cut does not read it resident. */
    wanted: (page: number) =>
      d.marks[page] === 1 && !(d.table.rowOfPage[page] >= 0 && d.table.residentFlags[page]),
    /** Whether a readback's closure holds `page`: its row is in use. */
    holds: (page: number) => d.held.delta.has(page),
    /** The demand is served again from its head: the table grew or was rebuilt. */
    restart() {
      d.next = 0
      d.fresh = d.count > 0
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
    /** Bytes of the marks, the list and the differences. */
    get bytes() {
      const { drawn, asked, ahead } = d.lists
      return (
        d.marks.byteLength +
        d.listed.byteLength +
        d.list.byteLength +
        drawn.bytes +
        asked.bytes +
        ahead.bytes
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
  /** The view whose differences it follows as they are applied, and what stops it. */
  following: { view: ViewDifferences | undefined; stop: () => void }
  /** The closure of every list: the rows in use. */
  held: InstanceClosure
  /** The closure of the requests: the instances wanted. */
  asking: InstanceClosure
  /** 1 on a wanted instance; on one in `list`, 1 too in `listed`. */
  marks: Uint8Array
  listed: Uint8Array
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

/** `page`, wanted by the requests' closure: asked for unless the cut reads it resident — a row
 *  whose record is owed is asked as a missing one is —, behind the demand already listed. */
function want(d: DemandState, page: number) {
  const row = d.rows[page] ?? -1
  if ((row >= 0 && d.flags[page]) || !d.drawsRow(page)) return
  if (page >= d.marks.length) {
    d.marks = grown(d.marks, page + 1, d.marks.length)
    d.listed = grown(d.listed, page + 1, d.listed.length)
  }
  d.marks[page] = 1
  if (d.listed[page]) return
  if (d.count === d.list.length) d.list = grown(d.list, d.count + 1, d.count)
  d.listed[page] = 1
  d.list[d.count++] = page
  d.fresh = true
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
  const { entered, exited, enteredCount, exitedCount } = d.asking.delta
  for (let i = 0; i < enteredCount; i++) want(d, entered[i])
  for (let i = 0; i < exitedCount; i++) if (exited[i] < d.marks.length) d.marks[exited[i]] = 0
}

const NONE: readonly number[] = []

/** The table's arrays read now: they are replaced as pages are added. */
function readTable(d: DemandState) {
  d.rows = d.table.rowOfPage
  d.flags = d.table.residentFlags
}

/** List `set`'s last difference into the closures: every list holds rows, the requests also want. */
function followList(d: DemandState, set: DemandState['lists']['drawn'], asks: boolean) {
  followUse(d, set.delta)
  if (asks) followAsks(d, set.delta)
}

/** `view`'s two lists followed from now on: read whole once, then each difference as applied. */
function attach(d: DemandState, view: ViewDifferences) {
  const { drawn, asked } = d.lists
  d.following.stop()
  drawn.apply(view.drawn.ids, view.drawn.count)
  asked.apply(view.asked.ids, view.asked.count)
  followList(d, drawn, false)
  followList(d, asked, true)
  const watch = (list: CutDelta, set: typeof drawn, asks: boolean) =>
    list.watch((changes) => {
      readTable(d)
      set.applyChanges(changes)
      followList(d, set, asks)
    })
  const stops = [watch(view.drawn, drawn, false), watch(view.asked, asked, true)]
  d.following = { view, stop: () => stops.forEach((stop) => stop()) }
}

function follow(d: DemandState, cut: CutLists, view: ViewDifferences | undefined) {
  readTable(d)
  d.use.tick()
  const { drawn, asked, ahead } = d.lists
  if (view && d.following.view !== view) attach(d, view)
  else if (!view) {
    d.following.stop()
    d.following = { view: undefined, stop: () => {} }
    drawn.apply(cut.drawablePageIds ?? NONE)
    asked.apply(cut.pageIds)
    followList(d, drawn, false)
    followList(d, asked, true)
  }
  ahead.apply(cut.aheadPageIds ?? NONE)
  followList(d, ahead, true)
}

function serve(
  d: DemandState,
  release: (page: number) => boolean,
  place: (page: number) => boolean,
  budget: FrameClock | undefined,
) {
  d.fresh = d.owed = false
  // An instance the requests let go since it was listed claims nothing more.
  const claims = (page: number) => d.marks[page] === 1 && release(page)
  const at = serveInOrder(d.list, d.next, d.count, claims, place, budget, STOP)
  if (at < 0) {
    d.next = ~at
    return d.count - d.next
  }
  d.next = at
  d.owed = d.next < d.count
  // Every request served or left for its bytes: the list starts again empty, the wanted kept.
  if (!d.owed) {
    for (let i = 0; i < d.count; i++) d.listed[d.list[i]] = 0
    d.count = d.next = 0
  }
  return 0
}
