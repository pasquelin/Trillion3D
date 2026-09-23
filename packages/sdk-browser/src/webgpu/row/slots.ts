import { sortPages } from '../../../../sdk-core/src/index.ts';
import { createWebgpuRowWriters } from './writers.ts';
import { createWebgpuRowClaims, serveClaims } from './claims.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import { rowHasGeometry, type createPageRowWriter } from './pageRow.ts';
import { awaitsPageBytes } from './pageSlots.ts';
import type { createWebgpuRowState } from './state.ts';

type Rows = ReturnType<typeof createWebgpuRowState>;
type Writer = ReturnType<typeof createPageRowWriter>;

/**
 * Ranks of the row table, held page by page.
 *
 * A page that enters takes a rank — the one a leaving page just freed, otherwise the end of the
 * table — and a page that leaves gives its own back. No image walks the catalogue again: what the
 * cache named is enough, and the list of named pages no longer overflows. Ranks stay contiguous,
 * because everything that reads the table reads `[0, packedCount)` without ever skipping an empty
 * row; ranks a pass frees without anyone taking them back are filled from the end of the table,
 * one move each.
 *
 * A page's rank therefore only changes if another page leaves in front of it, and the number
 * itself only has meaning for the current image: the record, the corners, the shadow sphere and
 * a row's occlusion verdict are rewritten with it as soon as it moves.
 *
 * Writing a record is what the image actually pays, and a burst of arrivals asks for as many at
 * once: they go through a queue bounded by a TIME budget. A page whose record is not yet written
 * is not resident — its flag only rises afterwards — so the cut does not choose it and its
 * resident parent covers it: no hole, only a late page.
 */
export function createWebgpuRowSlots(
  rows: Rows,
  packedPages: PageRec[],
  drawSlots: number,
  writePageRow: Writer,
  onResidenceChange: (rec: PageRec) => void,
) {
  /** Ranks this pass gave back, waiting for a taker or a fill. */
  const free = { rows: new Int32Array(Math.max(1, drawSlots)), count: 0 };
  /** Pages that claim a record and wait their turn, from one image to the next. */
  const claims = createWebgpuRowClaims(packedPages.length);
  const {
    assign,
    moveRow,
    state: written,
  } = createWebgpuRowWriters(rows, packedPages, writePageRow);
  let count = 0,
    candidates = 0,
    denied = 0,
    epoch = -1,
    revision = -1;

  /** True when a page's rank really carries its current place in the cache. */
  const rowWritten = (page: number) => {
    const row = rows.rowOfPage[page];
    return (
      row >= 0 &&
      rows.rowOffsetWords[row] === rows.residentOffsetWords[page] &&
      rows.rowEpoch[row] === rows.tableEpoch
    );
  };

  /**
   * Residency flag of a page, and the candidate count that follows it. Idempotent: a page named
   * twice by the same pass changes nothing the second time.
   *
   * A transparent cluster is resident, requested and budgeted like the others, but it does not
   * claim a visibility-buffer row: it draws in the blend pass, so it does not count.
   */
  const setResident = (page: number, resident: boolean) => {
    const value = resident ? 1 : 0;
    if (rows.residentFlags[page] === value) return;
    const rec = packedPages[page];
    rows.residentFlags[page] = value;
    rows.noteResidencyChange(page);
    onResidenceChange(rec);
    if (!rec.transparent) candidates += resident ? 1 : -1;
  };

  /**
   * Re-reads what the cache just did with a page and takes back the rank it no longer deserves.
   * Returns `true` when the page claims a record write — it is resident, drawable, and its rank
   * does not yet describe its place.
   */
  const release = (page: number) => {
    const rec = packedPages[page],
      offsetWords = rows.residentOffsetWords[page];
    const resident = offsetWords >= 0 && !awaitsPageBytes(rec);
    const wantsRow = resident && !rec.transparent && rowHasGeometry(rec, rows.pagePositions[page]);
    setResident(page, resident && (!wantsRow || rowWritten(page)));
    if (wantsRow) return !rows.residentFlags[page];
    const row = rows.rowOfPage[page];
    if (row < 0) return false;
    rows.rowOfPage[page] = -1;
    free.rows[free.count++] = row;
    written.changed = true;
    return false;
  };

  /**
   * Writes a page's record: at its rank if it is still its own, otherwise at a freed rank or at
   * the end of the table. The residency flag only rises afterwards. Returns `false` when the table
   * is full — that is then an overflow, and nothing will go further this image.
   */
  const place = (page: number) => {
    const offsetWords = rows.residentOffsetWords[page],
      row = rows.rowOfPage[page];
    if (row >= 0) assign(row, page, offsetWords);
    else if (free.count) assign(free.rows[--free.count], page, offsetWords);
    else if (count < drawSlots) assign(count++, page, offsetWords);
    else return false;
    setResident(page, true);
    return true;
  };

  /**
   * The end of the table fills ranks no page took back. Holes are walked from lowest to highest
   * and sources from highest to lowest, skipping ranks that are themselves free: each surviving
   * row is therefore moved at most once.
   */
  const closeFreeRows = () => {
    if (!free.count) return;
    sortPages(free.rows, free.count);
    const kept = count - free.count;
    let source = count - 1,
      high = free.count - 1;
    for (let i = 0; i < free.count; i++) {
      const hole = free.rows[i];
      if (hole >= kept) break;
      while (high >= 0 && free.rows[high] === source) {
        source--;
        high--;
      }
      moveRow(source--, hole);
    }
    count = kept;
    free.count = 0;
  };

  /**
   * The whole table rebuilt from the catalogue: rank order there is page order. The only remaining
   * reason is a new table age, or a table rewritten by another path — never a named-page list that
   * is too long, which no longer exists.
   */
  const rebuild = () => {
    rows.rowOfPage.fill(-1);
    count = 0;
    free.count = 0;
    written.changed = true;
    claims.clear();
    for (let page = 0; page < packedPages.length; page++) {
      if (!release(page) || place(page)) continue;
      // The table is full: the page keeps its claim and will take it back when a rank frees.
      denied++;
      claims.add(page);
    }
  };

  /** What the image owes the row table: the pages the cache named, and what the record queue
   *  left behind, within the time budget. */
  const apply = () => {
    written.changed = false;
    denied = 0;
    const full = revision !== rows.rowsRevision || epoch !== rows.tableEpoch;
    if (full) rebuild();
    else {
      // Departures first, arrivals next: a rank freed by a late-named page must be able to serve
      // an early-named page, otherwise an arrival overflows in front of a table that is about to
      // empty. Pages are seen in catalogue order, as reconstruction would see them.
      sortPages(rows.touched.pages, rows.touched.count);
      for (let i = 0; i < rows.touched.count; i++) {
        const page = rows.touched.pages[i];
        if (release(page)) claims.add(page);
      }
      denied = serveClaims(claims, release, place);
      closeFreeRows();
    }
    rows.clearTouched();
    // Departures and arrivals each name themselves in their order: GPU selection wants them sorted.
    rows.sortResidencyChanges();
    epoch = rows.tableEpoch;
    revision = ++rows.rowsRevision;
    if (written.changed || rows.packedCount !== count) rows.rowsChanged = true;
    rows.rowCount = count;
    rows.packedCount = count;
    rows.candidateCount = candidates;
    rows.candidateOverflow = denied;
  };
  return {
    apply,
    /** Records still owed: the next image must come back even if the cache moved nothing. */
    get pending() {
      return claims.count;
    },
  };
}
