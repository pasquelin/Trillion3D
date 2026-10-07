import { grown } from '../../page/cut/sparseInts.ts'
import type { FrameClock } from '../../page/integration/frameBudget.ts'
import type { RowUse } from './rowUse.ts'
import { serveInOrder } from './claims.ts'

/** What a readback names, as packed instances: those its cut drew, and those it asks for — the
 *  camera's, then the view ahead's — in the order the GPU ranked them (`../../gpu/dag/request.ts`). */
export type CutLists = {
  readonly drawablePageIds?: ArrayLike<number>
  readonly pageIds: ArrayLike<number>
  readonly aheadPageIds?: ArrayLike<number>
}

/** Hands `visit` every packed instance `ids` close over — themselves, their groups and the groups
 *  above —, each placement's own (`../../page/cut/groupClosure.ts`, `closeOver`). */
export type CloseInstances = (ids: ArrayLike<number>, visit: (id: number) => void) => void

/** A refused request stops the serve: the table has no row for it, nor for any after it. */
const STOP = () => true

/**
 * THE GPU CUT'S DEMAND FOR ROWS (#1483). The cut reads an instance as resident only once its bytes
 * are AND it holds a row, so an instance whose bytes are in but which holds no row is drawn by its
 * nearest ready ancestor, and the cut ASKS for it, as for a page still on its way: every readback
 * lists the instances the view wants, ranked. Readiness is the group's, closed upward
 * (`../../page/cut/readiness.ts`): an instance draws once its group and the groups above it hold
 * rows. So the demand is what the requests close over, in their order, that draws from a row and
 * holds none: the row allocator serves it before any arrival (`slots.ts`), taking back a row unused
 * for a while (`rowUse.ts`) when the table is full. One still waiting for its bytes stays marked
 * and takes its row when they land.
 *
 * Each readback is followed once: it stamps the rows of what its drawn pages and its requests
 * close over — a group-mate outside the view keeps a drawn page ready —, then replaces the demand.
 * One mark per instance (a byte), the list bounded by the view's requests.
 */
export function createRowDemand(
  rowOfPage: () => Int32Array,
  use: RowUse,
  /** Whether a packed instance draws from a visibility row once resident: opaque, with geometry. */
  drawsRow: (page: number) => boolean,
  pageCount: number,
  closeInstances: CloseInstances,
) {
  const d: DemandState = {
    ...{ rowOfPage, use, drawsRow, closeInstances },
    marks: new Uint8Array(Math.max(1, pageCount)),
    list: new Int32Array(8),
    ...{ count: 0, next: 0, fresh: false, owed: false },
    rows: new Int32Array(0),
    asking: false,
    visit: (page: number) => visit(d, page),
  }
  return {
    /** The readback just adopted: its rows stamped, its demand in place of the last one. */
    follow: (cut: CutLists) => follow(d, cut),
    /** Whether the last readback asked for `page` and it holds no row. */
    wanted: (page: number) => d.marks[page] === 1,
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
     * instance still claims a row — resident and without one —, `place` gives it one and returns
     * false when no row is free nor unused: the serve stops there. Returns how many requests the
     * table left without a row: what it grows by (`../pages/prepare/growTables.ts`).
     */
    serve: (
      release: (page: number) => boolean,
      place: (page: number) => boolean,
      budget?: FrameClock,
    ) => serve(d, release, place, budget),
    /** Bytes of the marks and the list. */
    get bytes() {
      return d.marks.byteLength + d.list.byteLength
    },
  }
}

type DemandState = {
  rowOfPage: () => Int32Array
  use: RowUse
  drawsRow: (page: number) => boolean
  closeInstances: CloseInstances
  marks: Uint8Array
  list: Int32Array
  count: number
  next: number
  /** A readback was followed, or the table moved, since the demand was last served. */
  fresh: boolean
  /** The time budget stopped the last serve: the next image goes on. */
  owed: boolean
  rows: Int32Array
  asking: boolean
  /** `visit` bound to this demand, made once: the closure every walk hands `closeInstances`. */
  visit: (page: number) => void
}

/** A page the readback names, closed over: its row is in use, or it is asked for. */
function visit(d: DemandState, page: number) {
  const row = d.rows[page] ?? -1
  if (row >= 0) return d.use.stamp(row)
  if (!d.asking) return
  if (page >= d.marks.length) d.marks = grown(d.marks, page + 1, d.marks.length)
  if (d.marks[page] || !d.drawsRow(page)) return
  if (d.count === d.list.length) d.list = grown(d.list, d.count + 1, d.count)
  d.marks[page] = 1
  d.list[d.count++] = page
}

function walk(d: DemandState, ids: ArrayLike<number> | undefined, asks: boolean) {
  if (!ids?.length) return
  d.asking = asks
  d.closeInstances(ids, d.visit)
}

function follow(d: DemandState, cut: CutLists) {
  d.rows = d.rowOfPage()
  d.use.tick()
  for (let i = 0; i < d.count; i++) d.marks[d.list[i]] = 0
  d.count = d.next = 0
  walk(d, cut.drawablePageIds, false)
  walk(d, cut.pageIds, true)
  walk(d, cut.aheadPageIds, true)
  d.fresh = d.count > 0
}

function serve(
  d: DemandState,
  release: (page: number) => boolean,
  place: (page: number) => boolean,
  budget: FrameClock | undefined,
) {
  d.fresh = d.owed = false
  const at = serveInOrder(d.list, d.next, d.count, release, place, budget, STOP)
  if (at < 0) {
    d.next = ~at
    return d.count - d.next
  }
  d.next = at
  d.owed = d.next < d.count
  return 0
}
