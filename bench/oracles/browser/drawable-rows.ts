// Batch F oracles, row-table side: `packages/sdk-browser/src/webgpu/row/state.ts:5-14,46`, `packages/sdk-browser/src/webgpu/row/commit.ts:91-97`
// and `packages/sdk-browser/src/webgpu/row/sync.ts:79` from before batch F, copied as-is.
import {
  PAGE_INFO_STRIDE,
  VIS_TRIANGLE_BITS,
} from '../../../packages/sdk-browser/src/visibility/buffer.ts';
import {
  ROW_ID_BASE_WORD,
  ROW_HIZ_SLOT_WORD,
} from '../../../packages/sdk-browser/src/webgpu/row/pageRow.ts';
import { createWebgpuRowJournal } from '../../../packages/sdk-browser/src/webgpu/row/journal.ts';
import type { PageRec } from '../../../packages/sdk-browser/src/page/selection/types.ts';

/** A row writer exactly as `packages/sdk-browser/src/webgpu/row/pageRow.ts` types it: `createWebgpuRowCommit`'s own signature
 *  in the fixture that mounts both sides requires this exact shape. The corner count a row draws
 *  is the writer's own business — it reads it from the record — so no index array crosses here. */
type RowWriter = (
  rec: PageRec,
  pageIndex: number,
  row: number,
  offsetWords: number,
  floats: Float32Array,
  ints: Uint32Array,
) => void;

/** Row state before batch F: a page's rank lived in a hash table. */
export function referenceRowState(packedPages: readonly PageRec[], drawSlots: number) {
  const pageIndexByRec = new Map<PageRec, number>();
  const pageIndicesByUrl = new Map<string, number[]>();
  for (let i = 0; i < packedPages.length; i++) {
    pageIndexByRec.set(packedPages[i], i);
    const url = packedPages[i].url,
      indices = pageIndicesByUrl.get(url);
    if (indices) indices.push(i);
    else pageIndicesByUrl.set(url, [i]);
  }
  // The journal of named pages and residencies that moved during the pass: later than
  // batch F, it is not the optimisation this oracle splits, and it is taken as-is so
  // the shared rank sync runs identically on both sides.
  const journal = createWebgpuRowJournal(packedPages.length);
  const etat = {
    ...journal,
    residentFlags: new Uint32Array(packedPages.length),
    pageIndicesByUrl,
    residentOffsetWords: new Int32Array(packedPages.length).fill(-1),
    rowPageIndex: new Int32Array(drawSlots).fill(-1),
    rowOffsetWords: new Int32Array(drawSlots).fill(-1),
    rowEpoch: new Int32Array(drawSlots),
    packedPageIndex: new Int32Array(drawSlots),
    newRowPage: new Int32Array(drawSlots),
    newRowSource: new Int32Array(drawSlots),
    rowOfPage: new Int32Array(packedPages.length).fill(-1),
    rowRewrites: new Int32Array(drawSlots),
    packedRecs: new Array<PageRec | undefined>(drawSlots).fill(undefined),
    packedPositions: new Array<GPUBuffer | undefined>(drawSlots).fill(undefined),
    pagePositions: new Array<GPUBuffer | undefined>(packedPages.length).fill(undefined),
    rowCount: 0,
    tableEpoch: 1,
    rowsEpoch: 0,
    dirtyFrom: drawSlots,
    dirtyTo: -1,
    candidateCount: 0,
    candidateOverflow: 0,
    packedCount: 0,
    rowsChanged: true,
    // Age of the rank allocator, also later than batch F.
    rowsRevision: 0,
    pageTableFloats: undefined as Float32Array | undefined,
    pageTableInts: undefined as Uint32Array | undefined,
    pageIndexOf: (rec: PageRec) => pageIndexByRec.get(rec),
    markRowDirty(row: number) {
      if (row < etat.dirtyFrom) etat.dirtyFrom = row;
      if (row > etat.dirtyTo) etat.dirtyTo = row;
    },
  };
  return etat;
}

type ReferenceRows = ReturnType<typeof referenceRowState>;

/** `packages/sdk-browser/src/webgpu/row/commit.ts` before batch F: the queue rewrote the four arrays row by row. */
export function referenceRowCommit(rows: ReferenceRows, writePageRow: RowWriter) {
  const commitRows = (count: number, monotone: boolean) => {
    const floats = rows.pageTableFloats,
      ints = rows.pageTableInts,
      rowWords = PAGE_INFO_STRIDE / 4;
    // Always bound before a commit: the mount that builds `rows` sets both before syncing.
    if (!floats || !ints) return;
    let rewrites = 0,
      moved = 0;
    const move = (start: number, end: number, delta: number) => {
      floats.copyWithin(start * rowWords, (start + delta) * rowWords, (end + delta + 1) * rowWords);
      for (let row = start; row <= end; row++) {
        const base = row * rowWords;
        ints[base + ROW_ID_BASE_WORD] = ((row + 1) << VIS_TRIANGLE_BITS) >>> 0;
        ints[base + ROW_HIZ_SLOT_WORD] = row;
      }
      rows.markRowDirty(start);
      rows.markRowDirty(end);
      moved += end - start + 1;
    };
    if (monotone)
      for (let pass = 0; pass < 2; pass++) {
        const negative = pass === 0;
        let start = -1,
          end = -1,
          delta = 0;
        const flush = () => {
          if (start >= 0) move(start, end, delta);
          start = -1;
        };
        for (let step = 0; step < count; step++) {
          const row = negative ? count - 1 - step : step;
          const source = rows.newRowSource[row],
            d = source >= 0 ? source - row : 0;
          const keep = source >= 0 && (negative ? d < 0 : d > 0);
          if (keep && start >= 0 && d === delta && row === (negative ? start - 1 : end + 1)) {
            if (negative) start = row;
            else end = row;
            continue;
          }
          flush();
          if (keep) {
            start = row;
            end = row;
            delta = d;
          }
        }
        flush();
      }
    for (let row = 0; row < count; row++)
      if (!(monotone && rows.newRowSource[row] >= 0)) rows.rowRewrites[rewrites++] = row;
    for (let r = 0; r < rewrites; r++) {
      const row = rows.rowRewrites[r],
        pageIndex = rows.newRowPage[row],
        rec = rows.packedRecs[row];
      if (!rec) continue;
      writePageRow(rec, pageIndex, row, rows.residentOffsetWords[pageIndex], floats, ints);
    }
    if (rewrites || moved) rows.rowsChanged = true;
    for (let row = 0; row < count; row++) {
      const pageIndex = rows.newRowPage[row];
      rows.rowPageIndex[row] = pageIndex;
      rows.rowOffsetWords[row] = rows.residentOffsetWords[pageIndex];
      rows.rowEpoch[row] = rows.tableEpoch;
      rows.rowOfPage[pageIndex] = row;
    }
    if (count !== rows.rowCount) rows.rowsChanged = true;
    rows.rowCount = count;
    rows.packedCount = count;
    // Later than batch F, like the journal: the CPU cut has posed its own ranks, so
    // the incremental allocator restarts from the catalogue. Taken here so both sides
    // advance together.
    rows.rowsRevision++;
  };
  const sourceRowOf = (pageIndex: number, offsetWords: number) => {
    const source = rows.rowOfPage[pageIndex];
    if (source < 0 || source >= rows.rowCount || rows.rowPageIndex[source] !== pageIndex) return -1;
    return rows.rowOffsetWords[source] === offsetWords && rows.rowEpoch[source] === rows.tableEpoch
      ? source
      : -1;
  };
  return { commitRows, sourceRowOf, writePageRow };
}
