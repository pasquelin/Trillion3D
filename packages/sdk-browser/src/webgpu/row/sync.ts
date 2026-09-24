import type { PageRec } from '../../page/selection/selection.ts';
import type { createWebgpuResidencyMirror } from '../residency/mirror.ts';
import type { createWebgpuRowState } from './state.ts';
import type { createWebgpuRowCommit } from './commit.ts';
import { createWebgpuRowSlots } from './slots.ts';
import { rowHasGeometry } from './pageRow.ts';
import { awaitsPageBytes } from './pageSlots.ts';

type Rows = ReturnType<typeof createWebgpuRowState>;
type Mirror = ReturnType<typeof createWebgpuResidencyMirror>;
type Commit = ReturnType<typeof createWebgpuRowCommit>;

/** Keeps the drawable row table aligned with cache residency or a CPU-selected cut. */
export function createWebgpuRowSync(
  rows: Rows,
  mirror: Mirror,
  packedPages: PageRec[],
  drawn: PageRec[],
  drawSlots: number,
  cacheReady: () => boolean,
  { commitRows, sourceRowOf, writePageRow }: Commit,
  /** Called when a page enters residency or leaves it, before the row changes. */
  onResidenceChange: (rec: PageRec) => void = () => {},
) {
  const slots = createWebgpuRowSlots(rows, packedPages, drawSlots, writePageRow, onResidenceChange);
  /**
   * Rows for the drawable set. What the image owes the table now depends only on the pages whose
   * cache slot just changed, and on what the previous image's time budget left to write: the whole
   * catalogue is walked again only on a rebuild, which the rank allocator decides alone, and never
   * again because a list overflowed. `bounded` false lifts the per-image time budget (a barrier image).
   */
  const syncRows = (bounded = true) => {
    if (!cacheReady() || !rows.pageTableFloats) return;
    // The journal describes only this pass: what it named has already been applied or dropped.
    rows.clearResidencyChanges();
    mirror.sync();
    // Rows still owed recall the pass even if the cache has moved nothing more: they carry pages the
    // previous image left outside residency, for lack of time.
    if (
      !mirror.dirty &&
      !rows.touched.count &&
      !slots.pending &&
      rows.rowsEpoch === rows.tableEpoch
    )
      return;
    mirror.dirty = false;
    rows.rowsEpoch = rows.tableEpoch;
    slots.apply(bounded);
  };
  /**
   * The CPU cut names its own pages, so its rows are its order; the cut is rebuilt every frame.
   * `casters` are pages the light cuts selected and the camera does not draw: they take rows
   * behind the camera's, which only the shadow pass reads. Returns the camera's row count.
   */
  const syncRowsFromCut = (casters: readonly PageRec[] = []) => {
    if (!cacheReady() || !rows.pageTableFloats) return 0;
    mirror.sync();
    // The CPU cut names its own rows, so this path never skips: `mirror.dirty` belongs to the ranks.
    mirror.dirty = true;
    let count = 0,
      lastSource = -1,
      monotone = true;
    const place = (rec: PageRec) => {
      if (rec.transparent || count >= drawSlots) return;
      const pageIndex = rows.pageIndexOf(rec);
      if (pageIndex === undefined) return;
      const offsetWords = rows.residentOffsetWords[pageIndex],
        position = rows.pagePositions[pageIndex];
      if (offsetWords < 0 || awaitsPageBytes(rec) || !rowHasGeometry(rec, position)) return;
      const row = count++;
      const source = sourceRowOf(pageIndex, offsetWords);
      if (source >= 0) {
        if (source <= lastSource) monotone = false;
        lastSource = source;
      }
      rows.newRowPage[row] = pageIndex;
      rows.newRowSource[row] = source;
      rows.packedRecs[row] = rec;
      rows.packedPositions[row] = position;
      rows.packedPageIndex[row] = pageIndex;
    };
    for (let i = 0; i < drawn.length && count < drawSlots; i++) place(drawn[i]);
    const cameraRows = count;
    for (let i = 0; i < casters.length && count < drawSlots; i++) place(casters[i]);
    commitRows(count, monotone);
    return cameraRows;
  };
  /** Rows the time budget deferred to a later image. */
  const rowsOwed = () => slots.pending;
  return { syncRows, syncRowsFromCut, rowsOwed };
}
