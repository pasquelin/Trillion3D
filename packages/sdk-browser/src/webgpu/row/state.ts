import { createWebgpuRowJournal } from './journal.ts';
import { catalogueIndexOf, type PageRec } from '../../page/selection/selection.ts';
import { pageAddress } from './pageSlots.ts';
import { createDirtyRows } from './dirty.ts';

/** Stable row and residency arrays shared by the cut, visibility pass, and cache journal. */
export function createWebgpuRowState(packedPages: PageRec[], drawSlots: number) {
  const residentFlags = new Uint32Array(packedPages.length);
  // Packed ranks by pool ADDRESS: that is the key the cache names when a slot moves, and several
  // placements of one cluster share it.
  const pageIndicesByUrl = new Map<string, number[]>();
  for (let i = 0; i < packedPages.length; i++) {
    const page = packedPages[i],
      address = pageAddress(page);
    const indices = pageIndicesByUrl.get(address);
    if (indices) indices.push(i);
    else pageIndicesByUrl.set(address, [i]);
    page.packedIndex = i;
  }
  const pageIndexOf = (rec: PageRec) => catalogueIndexOf(packedPages, rec);

  /** Pages named by the cache and those whose residency flag just flipped. */
  const journal = createWebgpuRowJournal(packedPages.length);
  const residentOffsetWords = new Int32Array(packedPages.length).fill(-1);
  const rowPageIndex = new Int32Array(drawSlots).fill(-1);
  const rowOffsetWords = new Int32Array(drawSlots).fill(-1);
  const rowEpoch = new Int32Array(drawSlots);
  const packedPageIndex = new Int32Array(drawSlots);
  const newRowPage = new Int32Array(drawSlots);
  const newRowSource = new Int32Array(drawSlots);
  const rowOfPage = new Int32Array(packedPages.length).fill(-1);
  const rowRewrites = new Int32Array(drawSlots);
  const packedRecs: Array<PageRec | undefined> = new Array(drawSlots).fill(undefined);
  const packedPositions: Array<GPUBuffer | undefined> = new Array(drawSlots).fill(undefined);
  const pagePositions: Array<GPUBuffer | undefined> = new Array(packedPages.length).fill(undefined);
  let rowCount = 0,
    tableEpoch = 1,
    rowsEpoch = 0;
  const dirtyRows = createDirtyRows(drawSlots);
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

  return {
    ...journal,
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
  };
}

/** What `dirtyRange` just computed, returned as-is: the buffer is reread on the spot by its caller,
 *  before any other call, so no image allocates to carry two integers. */
const dirty = { from: 0, to: -1 };

/**
 * Row range a witness must rewrite: the one the table declares dirty, bounded to the drawable rank.
 * A stale witness — the table's age has changed, or what it described no longer exists — asks for
 * the whole table again; otherwise a rank that grew widens the range to the rows that just entered.
 * `held` is the number of rows the witness held, never negative.
 */
export function dirtyRange(
  rows: { dirtyFrom: number; dirtyTo: number; packedCount: number },
  stale: boolean,
  held: number,
) {
  const last = rows.packedCount - 1;
  let from = rows.dirtyFrom,
    to = Math.min(rows.dirtyTo, last);
  if (stale) {
    from = 0;
    to = last;
  } else if (rows.packedCount > held) {
    from = Math.min(from, held);
    to = last;
  }
  dirty.from = from;
  dirty.to = to;
  return dirty;
}
