import { PAGE_INFO_STRIDE } from '../../visibility/buffer.ts';
import { ROW_ID_BASE_WORD, packedRowBase, restampHizSlot } from './pageRow.ts';
import type { createPageRowWriter } from './pageRow.ts';
import type { createWebgpuRowState } from './state.ts';
import { createPageCatalogue, type PageList } from '../pages/prepare/catalogue.ts';

type Rows = ReturnType<typeof createWebgpuRowState>;
type Writer = ReturnType<typeof createPageRowWriter>;

/**
 * The only two ways a row-table rank changes occupant: a page is posted there, or a whole row is
 * moved there. Both keep the parallel arrays that say who occupies what up to date, and raise
 * `state.changed` so the image knows it must send the table again.
 */
export function createWebgpuRowWriters(rows: Rows, packedPages: PageList, writePageRow: Writer) {
  const rowWords = PAGE_INFO_STRIDE / 4;
  const state = { changed: false };
  /** A packed rank back to its record: the one catalogue accessor (`../pages/prepare/catalogue.ts`). */
  const { recordOf } = createPageCatalogue(packedPages);

  /** Posts page `page` at rank `row`: the row is written, therefore declared dirty, by the writer. */
  const assign = (row: number, page: number, offsetWords: number) => {
    const rec = recordOf(page)!;
    rows.packedRecs[row] = rec;
    rows.packedPositions[row] = rows.pagePositions[page];
    rows.packedPageIndex[row] = page;
    rows.rowPageIndex[row] = page;
    rows.rowOffsetWords[row] = offsetWords;
    rows.rowEpoch[row] = rows.tableEpoch;
    rows.rowOfPage[page] = row;
    state.changed = true;
    writePageRow(rec, page, row, offsetWords, rows.pageTableFloats!, rows.pageTableInts!);
  };

  /** Moves row `from` to rank `to`: the row's words, then the two that ARE the rank. */
  const moveRow = (from: number, to: number) => {
    const ints = rows.pageTableInts!,
      page = rows.packedPageIndex[from],
      base = to * rowWords;
    rows.pageTableFloats!.copyWithin(base, from * rowWords, (from + 1) * rowWords);
    ints[base + ROW_ID_BASE_WORD] = packedRowBase(to);
    restampHizSlot(ints, base, to);
    rows.packedRecs[to] = rows.packedRecs[from];
    rows.packedPositions[to] = rows.packedPositions[from];
    rows.packedPageIndex[to] = page;
    rows.rowPageIndex[to] = page;
    rows.rowOffsetWords[to] = rows.rowOffsetWords[from];
    rows.rowEpoch[to] = rows.rowEpoch[from];
    rows.rowOfPage[page] = to;
    rows.markRowDirty(to);
    state.changed = true;
  };

  return { assign, moveRow, state };
}
