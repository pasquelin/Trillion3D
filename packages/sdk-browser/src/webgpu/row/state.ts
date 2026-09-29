import { createWebgpuRowJournal } from './journal.ts';
import { catalogueIndexOf, type PageRec } from '../../page/selection/selection.ts';
import { pageAddress } from './pageSlots.ts';
import { createDirtyRows } from './dirty.ts';

/** `from` copied into the head of `to`, the rest of `to` set to `fill`. */
function widened<T extends Int32Array | Uint32Array>(from: T, to: T, fill: number) {
  to.set(from);
  to.fill(fill, from.length);
  return to;
}

/**
 * Stable row and residency arrays shared by the cut, visibility pass, and cache journal.
 *
 * The table holds `drawSlots` visibility rows, then `blendSlots` rows the shadow pass alone reads:
 * the blended clusters that cast (`blendCasters.ts`). A visibility pass reads `[0, packedCount)`
 * and never reaches them; the per-row arrays the shadow pass reads — record, catalogue page,
 * dirty marks — span both. The per-page arrays are replaced when pages join in place
 * (`addPages`): they are read through this object, never kept.
 */
export function createWebgpuRowState(packedPages: PageRec[], drawSlots: number, blendSlots = 0) {
  const casterSlots = drawSlots + blendSlots;
  // Packed ranks by pool ADDRESS: that is the key the cache names when a slot moves, and several
  // placements of one cluster share it.
  const pageIndicesByUrl = new Map<string, number[]>();
  const indexPages = (first: number) => {
    for (let i = first; i < packedPages.length; i++) {
      const page = packedPages[i],
        address = pageAddress(page);
      const indices = pageIndicesByUrl.get(address);
      if (indices) indices.push(i);
      else pageIndicesByUrl.set(address, [i]);
      page.packedIndex = i;
    }
  };
  indexPages(0);
  const pageIndexOf = (rec: PageRec) => catalogueIndexOf(packedPages, rec);

  /** Pages named by the cache and those whose residency flag just flipped. */
  const journal = createWebgpuRowJournal();
  const residentFlags = new Uint32Array(packedPages.length);
  const residentOffsetWords = new Int32Array(packedPages.length).fill(-1);
  const rowPageIndex = new Int32Array(drawSlots).fill(-1);
  const rowOffsetWords = new Int32Array(drawSlots).fill(-1);
  const rowEpoch = new Int32Array(drawSlots);
  const packedPageIndex = new Int32Array(casterSlots);
  const newRowPage = new Int32Array(drawSlots);
  const newRowSource = new Int32Array(drawSlots);
  const rowOfPage = new Int32Array(packedPages.length).fill(-1);
  const rowRewrites = new Int32Array(drawSlots);
  const packedRecs: Array<PageRec | undefined> = new Array(casterSlots).fill(undefined);
  /** Per catalogue page, the shadow-only row a blended cluster casts from, or -1. */
  const blendRowOf = new Int32Array(packedPages.length).fill(-1);
  const packedPositions: Array<GPUBuffer | undefined> = new Array(drawSlots).fill(undefined);
  const pagePositions: Array<GPUBuffer | undefined> = new Array(packedPages.length).fill(undefined);
  let rowCount = 0,
    tableEpoch = 1,
    rowsEpoch = 0;
  const dirtyRows = createDirtyRows(casterSlots);
  let candidateCount = 0,
    candidateOverflow = 0;
  /**
   * Age of the row table itself. Any write of ranks by a path other than the incremental allocator
   * advances it, and the allocator then rebuilds rather than trusting a page → rank mapping it did
   * not post.
   */
  let rowsRevision = 0;
  let packedCount = 0,
    rowsChanged = true;
  let pageTableFloats: Float32Array | undefined, pageTableInts: Uint32Array | undefined;

  const state = {
    ...journal,
    /** First shadow-only row, and the end of the table: `[drawSlots, casterSlots)`. */
    blendFirst: drawSlots,
    casterSlots,
    blendRowOf,
    residentFlags,
    pageIndicesByUrl,
    pageIndexOf,
    residentOffsetWords,
    rowPageIndex,
    rowOffsetWords,
    rowEpoch,
    packedPageIndex,
    newRowPage,
    newRowSource,
    rowOfPage,
    rowRewrites,
    packedRecs,
    packedPositions,
    pagePositions,
    /** Declares rows `[from, to]` dirty — one row by default —; `clearDirty` once all are sent. */
    markRowDirty: dirtyRows.mark,
    clearDirty: dirtyRows.clear,
    dirtyMarks: dirtyRows.marks,
    get rowCount() {
      return rowCount;
    },
    set rowCount(value: number) {
      rowCount = value;
    },
    get tableEpoch() {
      return tableEpoch;
    },
    set tableEpoch(value: number) {
      tableEpoch = value;
    },
    get rowsEpoch() {
      return rowsEpoch;
    },
    set rowsEpoch(value: number) {
      rowsEpoch = value;
    },
    /** First and last dirty rows: the span that bounds every mark. */
    get dirtyFrom() {
      return dirtyRows.span.from;
    },
    get dirtyTo() {
      return dirtyRows.span.to;
    },
    /** Row writes since the table was made (`rowsMoved`). */
    get rowWrites() {
      return dirtyRows.writes;
    },
    get candidateCount() {
      return candidateCount;
    },
    set candidateCount(value: number) {
      candidateCount = value;
    },
    get rowsRevision() {
      return rowsRevision;
    },
    set rowsRevision(value: number) {
      rowsRevision = value;
    },
    get candidateOverflow() {
      return candidateOverflow;
    },
    set candidateOverflow(value: number) {
      candidateOverflow = value;
    },
    get packedCount() {
      return packedCount;
    },
    set packedCount(value: number) {
      packedCount = value;
    },
    get rowsChanged() {
      return rowsChanged;
    },
    set rowsChanged(value: boolean) {
      rowsChanged = value;
    },
    get pageTableFloats() {
      return pageTableFloats;
    },
    set pageTableFloats(value: Float32Array | undefined) {
      pageTableFloats = value;
    },
    get pageTableInts() {
      return pageTableInts;
    },
    set pageTableInts(value: Uint32Array | undefined) {
      pageTableInts = value;
    },
    /**
     * `packedPages` grew from `first` on (`../../placement/webgpuGrowth.ts`): the per-page arrays
     * take the new pages, each with its pool slot and positions as the page at its address holds
     * them — no residency flag and no row yet —, and each is named to the journal.
     */
    addPages(first: number) {
      indexPages(first);
      const n = packedPages.length;
      state.residentFlags = widened(state.residentFlags, new Uint32Array(n), 0);
      state.residentOffsetWords = widened(state.residentOffsetWords, new Int32Array(n), -1);
      state.rowOfPage = widened(state.rowOfPage, new Int32Array(n), -1);
      state.blendRowOf = widened(state.blendRowOf, new Int32Array(n), -1);
      for (let page = first; page < n; page++) {
        const sibling = pageIndicesByUrl.get(pageAddress(packedPages[page]))![0];
        state.residentOffsetWords[page] = state.residentOffsetWords[sibling];
        state.pagePositions[page] = state.pagePositions[sibling];
        state.touchPage(page);
      }
    },
  };
  return state;
}
