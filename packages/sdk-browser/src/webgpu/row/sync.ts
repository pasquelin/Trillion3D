import type { PageRec } from '../../page/selection/selection.ts'
import type { PageList } from '../pages/prepare/catalogue.ts'
import type { createWebgpuResidencyMirror } from '../residency/mirror.ts'
import type { createWebgpuRowState } from './state.ts'
import type { createWebgpuRowCommit } from './commit.ts'
import { createWebgpuRowSlots } from './slots.ts'
import { rowHasGeometry } from './pageRow.ts'
import { awaitsPageBytes } from './pageSlots.ts'
import { createBlendCasterRows } from './blendCasters.ts'
import type { FrameClock } from '../../page/integration/frameBudget.ts'

type Rows = ReturnType<typeof createWebgpuRowState>
type Mirror = ReturnType<typeof createWebgpuResidencyMirror>
type Commit = ReturnType<typeof createWebgpuRowCommit>

/** Keeps the drawable row table aligned with cache residency or a CPU-selected cut. */
export function createWebgpuRowSync(
  rows: Rows,
  mirror: Mirror,
  packedPages: PageList,
  /** The drawn view's cut, read at each sync: a view switch replaces its `drawn`. */
  cut: { readonly drawn: readonly PageRec[]; readonly drawnPacked: readonly number[] },
  cacheReady: () => boolean,
  { commitRows, sourceRowOf, writePageRow }: Commit,
  /** Called when a page enters residency or leaves it, before the row changes. */
  onResidenceChange: (rec: PageRec, page: number) => void = () => {},
  /** Called when a blended caster's row is written again with another coverage. */
  onCoverageChange: (rec: PageRec, page: number) => void = () => {},
  /** The frame's one integration budget the owed records spend from (`claims.ts`). */
  budget?: FrameClock,
) {
  const slots = createWebgpuRowSlots(rows, packedPages, writePageRow, onResidenceChange)
  /** The blended clusters' caster rows, behind the visibility rows: they follow the residency the
   *  mirror reports (`follow`), and the table's age here, whichever cut draws the image. */
  const blendCasters = createBlendCasterRows(rows, packedPages, writePageRow, onCoverageChange)
  let asked = 0
  /**
   * Rows for the drawable set. What the image owes the table now depends only on the pages whose
   * cache slot just changed, and on what the previous image's time budget left to write: the whole
   * catalogue is walked again only on a rebuild, which the rank allocator decides alone, and never
   * again because a list overflowed. `bounded` false lifts the frame's budget (a barrier image).
   */
  const syncRows = (bounded = true) => {
    if (!cacheReady() || !rows.pageTableFloats) return
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
      return
    mirror.dirty = false
    rows.rowsEpoch = rows.tableEpoch
    slots.apply(bounded ? budget : undefined)
  }
  /**
   * The CPU cut names its own pages, so its rows are its order; the cut is rebuilt every frame.
   * Returns the camera's row count. The table's size is read here, at each sync: it grows in
   * place (`grow.ts`).
   */
  const syncRowsFromCut = () => {
    if (!cacheReady() || !rows.pageTableFloats) return 0
    const drawSlots = rows.blendFirst
    mirror.sync()
    blendCasters.refresh()
    // The CPU cut names its own rows, so this path never skips: `mirror.dirty` belongs to the ranks.
    mirror.dirty = true
    let count = 0,
      lastSource = -1,
      monotone = true
    asked = 0
    const place = (rec: PageRec, pageIndex: number) => {
      if (rec.transparent || pageIndex < 0) return
      const offsetWords = rows.residentOffsetWords[pageIndex],
        position = rows.pagePositions[pageIndex]
      if (offsetWords < 0 || awaitsPageBytes(rec) || !rowHasGeometry(rec, position)) return
      // Every row the cut selects is counted, even past the table: it is what the table grows to.
      asked++
      if (count >= drawSlots) return
      const row = count++
      const source = sourceRowOf(pageIndex, offsetWords)
      if (source >= 0) {
        if (source <= lastSource) monotone = false
        lastSource = source
      }
      rows.newRowPage[row] = pageIndex
      rows.newRowSource[row] = source
      rows.packedRecs[row] = rec
      rows.packedPositions[row] = position
      rows.packedPageIndex[row] = pageIndex
    }
    const { drawn, drawnPacked } = cut
    for (let i = 0; i < drawn.length; i++) place(drawn[i], drawnPacked[i])
    commitRows(count, monotone)
    return count
  }
  /** Rows the time budget deferred to a later image. */
  const rowsOwed = () => slots.pending
  /** Rows the last CPU cut selected, the table holding them or not (#1232). */
  const rowsAsked = () => asked
  return { syncRows, syncRowsFromCut, rowsOwed, rowsAsked, blendCasters }
}
