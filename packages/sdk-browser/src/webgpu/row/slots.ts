import { createWebgpuRowWriters } from './writers.ts'
import { createWebgpuRowClaims } from './claims.ts'
import type { PageRec } from '../../page/selection/selection.ts'
import { createPageCatalogue, type PageList } from '../../page/selection/catalogue.ts'
import { rowHasGeometry } from './pageRow.ts'
import type { PageRowWriter } from './pageRowWriter.ts'
import type { WebgpuRowState } from './state.ts'
import type { FrameClock } from '../../page/integration/frameBudget.ts'
import { createRowWords } from './rowWords.ts'
import { createRowOrder } from './rowOrder.ts'
import { createRowDemand } from './rowDemand.ts'
import type { InstanceClosure } from './rowDemandState.ts'
import { placeRow, releaseRow, type RowSlots } from './slotOps.ts'
import { closeFreeRows, followArrivals, rebuildRows, rewriteRows } from './rowPasses.ts'
/**
 * Ranks of the row table: a CACHE of what the GPU cut draws (#1483), sized by the view, never by
 * the placements (#1232). An instance is resident for the cut once its bytes are AND it holds a row
 * written at its place; the cut draws a nearest ready ancestor for the others. An arrival takes a
 * free row while the table has one; the cut's demand (`rowDemand.ts`) is served first, in the GPU's
 * order, taking back the row of the next page the GPU's queue gives up (`rowOrder.ts`) when none is
 * free; a request the table cannot serve while the GPU has nothing more to give is counted
 * (`rowsDenied`) and the table grows by it.
 *
 * Ranks stay contiguous — every reader reads `[0, packedCount)` —: ranks a pass frees are filled
 * from the end of the table, one move each, and a rank's record, corners, sphere and occlusion
 * verdict are rewritten with it. Records are written within the frame's time budget, the rest owed
 * to the next image; a page whose record is not yet written is not resident, so its ancestor draws
 * it: no hole, only a late page. A table grown in place (`grow.ts`) keeps every rank it held.
 */
export function createWebgpuRowSlots(
  rows: WebgpuRowState,
  packedPages: PageList,
  writePageRow: PageRowWriter,
  onResidenceChange: (rec: PageRec, page: number) => void,
  /** A counted closure over the instances, per placement: a request's readiness needs its
   *  groups' rows (`rowDemand.ts`). */
  closure: () => InstanceClosure,
  /** The host's frame, the clock the GPU stamps the rows' use with (`rowWords.ts`). */
  frame: () => number,
  /** Asks the next cut to cut again: a request waits for the queue it ranks (`rowOrder.ts`). */
  askOrder?: () => void,
) {
  const { recordOf } = createPageCatalogue(packedPages)
  const words = createRowWords()
  const drawsRow = (page: number) => {
    const rec = recordOf(page)!
    return !rec.transparent && rowHasGeometry(rec)
  }
  const s: RowSlots = {
    rows,
    packedPages,
    recordOf,
    drawsRow,
    onResidenceChange,
    words,
    order: createRowOrder(rows.rowOf, words, askOrder),
    frame,
    free: { rows: new Int32Array(0), count: 0 },
    claims: createWebgpuRowClaims(),
    demand: createRowDemand(rows, drawsRow, closure),
    writers: createWebgpuRowWriters(rows, packedPages, writePageRow),
    count: 0,
    candidates: 0,
    denied: 0,
    release: (page) => releaseRow(s, page),
    place: (page) => placeRow(s, page),
  }
  // The table's age and rows the cache last followed, and the generation its own arrays are sized
  // for: they follow it once per growth (`grow.ts`); the table's rows are `rows.blendFirst`.
  const seen = { epoch: -1, revision: -1, fitted: -1 }
  return {
    /** What the image owes the row table, within the frame's `budget`; absent, all (a barrier). */
    apply: (budget?: FrameClock) => applyRows(s, seen, budget),
    /** Follows a readback the host adopted: its requests, served next. */
    follow: s.demand.follow,
    /** Records still owed — arrivals, requests, or a table grown since —: the next image must come
     *  back even if the cache moved nothing. */
    get pending() {
      return s.claims.count > 0 || s.demand.pending || seen.fitted !== rows.generation
    },
    /** Bytes of the cache's own tables: a word per row, a mark per instance, the demand. */
    get bytes() {
      return s.words.bytes + s.demand.bytes
    },
    /** The rows' use words the GPU stamps (`rowWords.ts`). */
    words: s.words,
    /** A queue of the rows' victims a readback brought (`rowOrder.ts`): the requests waiting for
     *  it are served again. */
    followOrder(queue: Uint32Array | undefined, ranked: number, frame: number) {
      s.order.follow(queue, ranked, frame)
      s.demand.restart()
    },
    /** Frame `frame` cuts on the rows as they stand (`rowOrder.ts`). */
    noteFrame: (frame: number) => s.order.noteFrame(frame),
  }
}

/** One pass of the cache over the table (`apply`). */
function applyRows(
  s: RowSlots,
  seen: { epoch: number; revision: number; fitted: number },
  budget?: FrameClock,
) {
  const { rows, writers, demand } = s
  writers.state.changed = false
  s.denied = 0
  if (seen.fitted !== rows.generation) {
    seen.fitted = rows.generation
    if (s.free.rows.length < rows.blendFirst) s.free.rows = new Int32Array(rows.blendFirst)
    s.words.fit(rows.blendFirst)
    // The table grew: the requests it refused are served again from their head.
    demand.restart()
  }
  if (seen.revision !== rows.rowsRevision) rebuildRows(s)
  else if (seen.epoch !== rows.tableEpoch) rewriteRows(s)
  // Requests first, in the GPU's order: a rank they take back is not given to an arrival. A wanted
  // page whose bytes or slot moved since asks again.
  demand.touched(rows.touched.pages, rows.touched.count)
  // A request no row served waits for the GPU's next queue, unless it has nothing more to give.
  const refused = demand.serve(s.release, s.place, budget)
  s.denied = refused && s.order.denies(s.frame()) ? refused : 0
  followArrivals(s, budget)
  closeFreeRows(s)
  rows.clearTouched()
  // Departures and arrivals each name themselves in their order: GPU selection wants them sorted.
  rows.sortResidencyChanges()
  seen.epoch = rows.tableEpoch
  seen.revision = rows.rowsRevision
  if (writers.state.changed || rows.packedCount !== s.count) rows.rowsChanged = true
  rows.rowCount = s.count
  rows.packedCount = s.count
  rows.candidateCount = s.candidates
  rows.rowsDenied = s.denied
}
