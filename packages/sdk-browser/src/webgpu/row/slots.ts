import { createWebgpuRowWriters } from './writers.ts'
import { createWebgpuRowClaims } from './claims.ts'
import type { PageRec } from '../../page/selection/selection.ts'
import { createPageCatalogue, type PageList } from '../pages/prepare/catalogue.ts'
import { rowHasGeometry } from './pageRow.ts'
import type { createPageRowWriter } from './pageRowWriter.ts'
import type { createWebgpuRowState } from './state.ts'
import type { FrameClock } from '../../page/integration/frameBudget.ts'
import { createRowUse } from './rowUse.ts'
import { createRowDemand, type InstanceClosure } from './rowDemand.ts'
import {
  closeFreeRows,
  followArrivals,
  placeRow,
  rebuildRows,
  releaseRow,
  rewriteRows,
  type RowSlots,
} from './slotOps.ts'
type Rows = ReturnType<typeof createWebgpuRowState>
type Writer = ReturnType<typeof createPageRowWriter>
/**
 * Ranks of the row table: a CACHE of what the GPU cut draws (#1483), sized by the view, never by
 * the placements (#1232). An instance is resident for the cut once its bytes are AND it holds a row
 * written at its place; the cut draws a nearest ready ancestor for the others. An arrival takes a
 * free row while the table has one; the cut's demand (`rowDemand.ts`) is served first, in the GPU's
 * order, taking back a row unused for a while (`rowUse.ts`) when none is free; a request the table
 * cannot serve is counted (`rowsDenied`) and the table grows by it.
 *
 * Ranks stay contiguous — every reader reads `[0, packedCount)` —: ranks a pass frees are filled
 * from the end of the table, one move each, and a rank's record, corners, sphere and occlusion
 * verdict are rewritten with it. Records are written within the frame's time budget, the rest owed
 * to the next image; a page whose record is not yet written is not resident, so its ancestor draws
 * it: no hole, only a late page. A table grown in place (`grow.ts`) keeps every rank it held.
 */
export function createWebgpuRowSlots(
  rows: Rows,
  packedPages: PageList,
  writePageRow: Writer,
  onResidenceChange: (rec: PageRec, page: number) => void,
  /** A counted closure over the instances, per placement: a request's readiness needs its
   *  groups' rows (`rowDemand.ts`). */
  closure: () => InstanceClosure,
) {
  const { recordOf } = createPageCatalogue(packedPages)
  const use = createRowUse(0)
  const drawsRow = (page: number) => {
    const rec = recordOf(page)!
    return !rec.transparent && rowHasGeometry(rec)
  }
  const pages = packedPages.length
  const s: RowSlots = {
    rows,
    packedPages,
    recordOf,
    drawsRow,
    onResidenceChange,
    use,
    free: { rows: new Int32Array(0), count: 0 },
    claims: createWebgpuRowClaims(pages),
    demand: createRowDemand(rows, use, drawsRow, pages, closure),
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
    /** Follows a readback the host adopted: its rows stamped, its demand served next. */
    follow: s.demand.follow,
    /** Records still owed — arrivals, requests, or a table grown since —: the next image must come
     *  back even if the cache moved nothing. */
    get pending() {
      return s.claims.count > 0 || s.demand.pending || seen.fitted !== rows.generation
    },
    /** Bytes of the cache's own tables: a word per row, a mark per instance, the demand. */
    get bytes() {
      return use.bytes + s.demand.bytes
    },
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
    s.use.fit(rows.blendFirst)
    // The table grew: the requests it refused are served again from their head.
    demand.restart()
  }
  if (seen.revision !== rows.rowsRevision) rebuildRows(s)
  else if (seen.epoch !== rows.tableEpoch) rewriteRows(s)
  // Requests first, in the GPU's order: a rank they take back is not given to an arrival. A wanted
  // page whose bytes or slot moved since asks again.
  demand.touched(rows.touched.pages, rows.touched.count)
  s.denied = demand.serve(s.release, s.place, budget)
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
