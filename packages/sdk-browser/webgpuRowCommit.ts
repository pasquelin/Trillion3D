import { PAGE_INFO_STRIDE } from './visibilityBuffer.ts';
import { ROW_ID_BASE_WORD, ROW_HIZ_SLOT_WORD, packedRowBase } from './webgpuPageRow.ts';
import type { createPageRowWriter } from './webgpuPageRow.ts';
import type { createWebgpuRowState } from './webgpuRowState.ts';

type Rows = ReturnType<typeof createWebgpuRowState>;
type Writer = ReturnType<typeof createPageRowWriter>;

/** Moves stable row runs and rewrites only changed occupants. */
export function createWebgpuRowCommit(rows: Rows, writePageRow: Writer) {
  /**
   * Turns the ranks an image just decided into table rows. A row whose occupant kept its slot and epoch
   * is not rebuilt: it is moved. Ranks only ever shift as a block — one admission pushes every later
   * rank up by one — so `newRowSource` describes runs of constant displacement, and the whole run travels
   * in one `copyWithin`, followed by the two words of each row that *are* the rank. What remains to
   * build word by word is one row per page that arrived, changed GPU slot, or lost its epoch.
   *
   * The displacement is non-decreasing along the rows — both orders walk the pages ascending, so a
   * source row advances by at least one per row — which is what makes moving in place safe: the runs
   * that pull from below are applied from the last row down, the runs that pull from above from the
   * first row up, and neither can overwrite a source the other still has to read. A cut whose order is
   * not the catalogue's breaks that property, and `monotone` then rebuilds every row instead.
   */
  const commitRows = (count: number, monotone: boolean) => {
    const floats = rows.pageTableFloats!,
      ints = rows.pageTableInts!,
      rowWords = PAGE_INFO_STRIDE / 4;
    let rewrites = 0,
      moved = 0;
    /** Moves rows `[start..end]` from `[start+delta..end+delta]`, then restamps the rank each row is. */
    const move = (start: number, end: number, delta: number) => {
      floats.copyWithin(start * rowWords, (start + delta) * rowWords, (end + delta + 1) * rowWords);
      for (let row = start; row <= end; row++) {
        const base = row * rowWords;
        ints[base + ROW_ID_BASE_WORD] = packedRowBase(row);
        ints[base + ROW_HIZ_SLOT_WORD] = row;
      }
      rows.markRowDirty(start);
      rows.markRowDirty(end);
      moved += end - start + 1;
    };
    if (monotone)
      for (let pass = 0; pass < 2; pass++) {
        // Runs pulling from below travel from the last row down, runs pulling from above from the first row
        // up: neither can then overwrite a source a pending run still has to read.
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
    // The rebuilds come last: a row a run still had to read cannot already hold its new occupant.
    for (let r = 0; r < rewrites; r++) {
      const row = rows.rowRewrites[r],
        pageIndex = rows.newRowPage[row],
        rec = rows.packedRecs[row]!;
      writePageRow(
        rec,
        pageIndex,
        row,
        rows.residentOffsetWords[pageIndex],
        rec.array!,
        rows.pageTableFloats!,
        rows.pageTableInts!,
      );
    }
    if (rewrites || moved) rows.rowsChanged = true;
    // A row that kept its place already carries its page, word offset, epoch and inverse rank:
    // `sourceRowOf` only returned it because all four were still exact. Only moved rows and rebuilt
    // rows have something to rewrite. Two rows that would name the same page would have the same
    // source, which sets `monotone` false: the shortcut cannot let a stale inverse rank through.
    const rowPageIndex = rows.rowPageIndex,
      rowOffsetWords = rows.rowOffsetWords,
      rowEpoch = rows.rowEpoch,
      rowOfPage = rows.rowOfPage,
      residentOffsetWords = rows.residentOffsetWords,
      epoch = rows.tableEpoch;
    for (let row = 0; row < count; row++) {
      if (monotone && rows.newRowSource[row] === row) continue;
      const pageIndex = rows.newRowPage[row];
      rowPageIndex[row] = pageIndex;
      rowOffsetWords[row] = residentOffsetWords[pageIndex];
      rowEpoch[row] = epoch;
      rowOfPage[pageIndex] = row;
    }
    // A shorter drawable set leaves the rows past it unread: `tableRows` bounds every pass that walks
    // the table, so they are not cleared, only forgotten.
    if (count !== rows.rowCount) rows.rowsChanged = true;
    rows.rowCount = count;
    rows.packedCount = count;
    // The CPU cut posted its own ranks: the incremental allocator can no longer trust the page → rank
    // mapping it held, and starts over from the catalogue on its next pass.
    rows.rowsRevision++;
  };
  /** Where the previous image wrote this page, or -1 when its row cannot be reused as it stands. */
  const sourceRowOf = (pageIndex: number, offsetWords: number) => {
    const source = rows.rowOfPage[pageIndex];
    if (source < 0 || source >= rows.rowCount || rows.rowPageIndex[source] !== pageIndex) return -1;
    return rows.rowOffsetWords[source] === offsetWords && rows.rowEpoch[source] === rows.tableEpoch
      ? source
      : -1;
  };
  return { commitRows, sourceRowOf, writePageRow };
}
