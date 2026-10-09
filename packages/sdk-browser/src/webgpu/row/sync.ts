import type { PageRec } from '../../page/selection/selection.ts'
import type { PageList } from '../pages/prepare/catalogue.ts'
import type { createWebgpuResidencyMirror } from '../residency/mirror.ts'
import type { createWebgpuRowState } from './state.ts'
import type { createPageRowWriter } from './pageRowWriter.ts'
import { createWebgpuRowSlots } from './slots.ts'
import type { CutLists, InstanceClosure } from './rowDemand.ts'
import { createBlendCasterRows } from './blendCasters.ts'
import type { FrameClock } from '../../page/integration/frameBudget.ts'

type Rows = ReturnType<typeof createWebgpuRowState>
type Mirror = Pick<ReturnType<typeof createWebgpuResidencyMirror>, 'sync' | 'dirty'>
type Writer = ReturnType<typeof createPageRowWriter>

/** Keeps the drawable row table a cache of what the GPU cut draws and asks for (`slots.ts`). */
export function createWebgpuRowSync(
  rows: Rows,
  mirror: Mirror,
  packedPages: PageList,
  cacheReady: () => boolean,
  writePageRow: Writer,
  /** A counted closure over the instances, per placement (`rowDemand.ts`). */
  closure: () => InstanceClosure,
  /** Called when a page enters residency or leaves it, before the row changes. */
  onResidenceChange: (rec: PageRec, page: number) => void = () => {},
  /** Called when a blended caster's row is written again with another coverage. */
  onCoverageChange: (rec: PageRec, page: number) => void = () => {},
  /** The frame's one integration budget the owed records spend from (`claims.ts`). */
  budget?: FrameClock,
) {
  const slots = createWebgpuRowSlots(rows, packedPages, writePageRow, onResidenceChange, closure)
  /** The blended clusters' caster rows, behind the visibility rows: they follow the residency the
   *  mirror reports (`follow`), and the table's age here. */
  const blendCasters = createBlendCasterRows(rows, packedPages, writePageRow, onCoverageChange)
  /** The readback last followed: each is followed once, whichever view adopted it. */
  let followed: object | null = null
  /**
   * Rows for the drawable set. What the image owes the table depends only on the pages whose cache
   * slot just changed, on the readback the GPU cut just brought (`followCut`), and on what the
   * previous image's time budget left to write: the whole catalogue is walked again only on a
   * rebuild, which the rank allocator decides alone. `bounded` false lifts the frame's budget (a
   * barrier image). Returns whether the table was passed over.
   */
  const syncRows = (bounded = true) => {
    if (!cacheReady() || !rows.pageTableFloats) return false
    // The journal describes only this pass: what it named has already been applied or dropped.
    rows.clearResidencyChanges()
    mirror.sync()
    blendCasters.refresh()
    // Rows still owed recall the pass even if the cache has moved nothing more: they carry pages the
    // previous image left outside residency, for lack of time.
    if (
      !mirror.dirty &&
      !rows.touched.count &&
      !slots.pending &&
      rows.rowsEpoch === rows.tableEpoch
    )
      return false
    mirror.dirty = false
    rows.rowsEpoch = rows.tableEpoch
    slots.apply(bounded ? budget : undefined)
    return true
  }
  /** A readback a view adopted (`cut`, its identity new per readback): its rows stamped used, its
   *  requests for instances without a row served at the next sync. */
  const followCut = (cut: { readonly result: CutLists } | null | undefined) => {
    if (!cut || cut === followed) return
    followed = cut
    slots.follow(cut.result)
  }
  /** Rows the time budget deferred to a later image. */
  const rowsOwed = () => slots.pending
  return {
    syncRows,
    followCut,
    rowsOwed,
    blendCasters,
    /** Bytes of the row cache's own tables (`slots.ts`). */
    get cacheBytes() {
      return slots.bytes
    },
  }
}
