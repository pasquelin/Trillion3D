import { createSparseInts } from '../../page/cut/sparseInts.ts'
import type { FrameClock } from '../../page/integration/frameBudget.ts'
import { STOP, claimsAt, placedAt, serve } from './rowDemandServe.ts'
import { createCutDelta, type IdDelta } from '../cut/delta.ts'
import {
  compact,
  isWanted,
  markWanted,
  readsResident,
  rerank,
  want,
  type DemandState,
  type InstanceClosure,
} from './rowDemandState.ts'

/** What a readback names that the rows ask for, as packed instances: the camera's requests, then
 *  the view ahead's, in the order the GPU ranked them (`../../gpu/dag/request.ts`). */
export type CutLists = {
  readonly pageIds: ArrayLike<number>
  readonly aheadPageIds?: ArrayLike<number>
}

/**
 * THE GPU CUT'S DEMAND FOR ROWS (#1483). The cut reads an instance as resident only once its bytes
 * are AND it holds a row written at its place, so an instance whose bytes are in but which holds
 * no row is drawn by its nearest ready ancestor, and the cut ASKS for it, as for a page still on
 * its way: every readback lists the instances the view wants, ranked. Readiness is the group's,
 * closed upward (`../../page/cut/readiness.ts`): an instance draws once its group and the groups
 * above it are resident. So the demand is what the requests close over that draws from a row and
 * is not resident for the cut — no row, or one whose record is still owed: a missing ancestor is
 * asked as the leaf under it is, and no cut stays empty for it. The row allocator serves it before
 * any arrival (`slots.ts`), taking back the row of the next page the GPU's queue gives up
 * (`rowOrder.ts`) when the table is full: which rows are in use is the GPU's to say, from the
 * whole lists of every cut that ran (`rowClosureWgsl.ts`), never a closure the host follows. One
 * still waiting for its bytes stays marked and takes its row when they land.
 *
 * Nothing is closed over again per readback: the request lists reach the demand as their
 * differences (`../cut/delta.ts`), and one counted closure follows the differences alone: the
 * instances the requests want. What a difference brings is listed in the readback's order, each
 * group-mate behind the request it came in with. A page whose bytes land or leave while wanted is
 * read again as the row journal names it (`touched`), and one whose row a rebuild dropped as the
 * rebuild names it (`rowPasses.ts`, `rebuildRows`).
 *
 * One live entry per page: the serve unlists every entry it passes — let go, served, or waiting
 * for its bytes, a page is listed again as it comes back, lands or loses its row, a group-mate with
 * the request it came in with (`waitingBy`) — and the passed entries are dropped, with those let
 * go or served since, once they are half the list, at a refusal and before a re-rank. Only when
 * the last serve left entries is what is pending ranked again in the order of the readback just
 * followed, so a nearer new request never waits behind an older one. A refusal counts the live
 * requests without a row: what the table grows by, when the GPU's queue has nothing more to give.
 *
 * Cost per readback adopted, for lists of A asked and H ahead ids and differences of ΔA and ΔH:
 * O(A + H) marks read, no record; O((ΔA + ΔH)·g) closure, g the pages a group holds; O(touched)
 * per sync for landings; O(wanted) served, amortized; O(A + H + P log P) more for the P live
 * entries a serve left. The drawn list costs nothing. A still camera adopts no readback: zero.
 */
export function createRowDemand(
  /** The row table, read at each readback: each page's row and residency flag. */
  table: DemandState['table'],
  /** Whether a packed instance draws from a visibility row once resident: opaque, with geometry. */
  drawsRow: (page: number) => boolean,
  /** A new counted closure over the instances, per placement. */
  closure: () => InstanceClosure,
) {
  const d: DemandState = {
    ...{ table, drawsRow },
    lists: { asked: createCutDelta(), ahead: createCutDelta() },
    asking: closure(),
    marks: createSparseInts(),
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
    wanted: (page: number) => isWanted(d, page) && !readsResident(d, page),
    /** The live demand is served again: the table grew, was rebuilt, or a queue of victims came. */
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
     * writes it, at its own row or another, and returns false when no row is free nor given up by
     * the GPU's queue: the serve stops there. Returns how many requests the table left without a
     * row (`../pages/prepare/growTables.ts`).
     */
    serve: (
      release: (page: number) => boolean,
      place: (page: number) => boolean,
      budget?: FrameClock,
    ) => serve(d, release, place, budget),
    /** Bytes of the marks, the list, the differences and the closure. */
    get bytes() {
      const { asked, ahead } = d.lists,
        { keys, pages, by } = d.scratch
      return (
        d.marks.byteLength +
        d.list.byteLength +
        d.by.byteLength +
        d.waitingBy.byteLength +
        d.ranks.byteLength +
        keys.byteLength +
        pages.byteLength +
        by.byteLength +
        asked.hostBytes +
        ahead.hostBytes +
        d.asking.hostBytes
      )
    },
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
    markWanted(d, page, false)
    if (d.waitingBy.size) d.waitingBy.set(page, 0)
  }
}

const NONE: readonly number[] = []

function follow(d: DemandState, cut: CutLists) {
  // Entries the last serve left: what this readback asks is ranked with them.
  const behind = d.count > d.next
  const { asked, ahead } = d.lists
  asked.apply(cut.pageIds)
  ahead.apply(cut.aheadPageIds ?? NONE)
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
