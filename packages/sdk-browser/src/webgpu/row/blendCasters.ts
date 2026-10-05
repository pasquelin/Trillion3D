import type { PageRec } from '../../page/selection/selection.ts';
import { PAGE_INFO_STRIDE } from '../../visibility/buffer.ts';
import { castsBlendShadow } from '../../gpu/shadow/transmittance.ts';
import {
  ROW_BLEND_COVERAGE_WORD,
  ROW_INDEX_WORDS,
  ROW_TRANSMISSION_WORD,
  type createPageRowWriter,
} from './pageRow.ts';
import type { createWebgpuRowState } from './state.ts';
import { awaitsPageBytes } from './pageSlots.ts';
import { createPageCatalogue, type PageList } from '../pages/prepare/catalogue.ts';

type Rows = ReturnType<typeof createWebgpuRowState>;
type Writer = ReturnType<typeof createPageRowWriter>;
const ROW_WORDS = PAGE_INFO_STRIDE / 4;

/**
 * The shadow casters of the blended clusters, WITHOUT a visibility row.
 *
 * A blended cluster is drawn in source order by the blend pass, never into the visibility buffer,
 * so it claims no rank of `[0, drawSlots)`. To cast, it takes a row of `[drawSlots, casterSlots)`
 * (`state.ts`), written by the same writer as any row (`pageRow.ts`): the same page-table record,
 * sphere, mobility word and dirty mark, which the shadow cull and the shadow raster read like any
 * caster's. No visibility pass reads past `packedCount`, and no table of theirs changes.
 *
 * A row follows residency, as a visibility row does: taken when the cluster's slot arrives, written
 * again when it moves, given back when it leaves. The whole set is written again when the table's
 * age moves — a pose or a material rewritten by the host — or the table itself is new (a lost
 * device). The pool bounds the rows: `blendSlots` covers every placement it can hold at once.
 * A table grown in place (`grow.ts`) moves the casters' rows behind its new visibility rows: every
 * caster gives its row back and takes one of the new range.
 *
 * A row the host's rewrite of a surface takes, gives back or writes with another coverage calls
 * `onCoverageChange`: the shadow pages under the cluster no longer describe it. A row that follows
 * residency need not, since residency itself restales them.
 */
export function createBlendCasterRows(
  rows: Rows,
  packedPages: PageList,
  writePageRow: Writer,
  onCoverageChange: (rec: PageRec, page: number) => void = () => {},
) {
  /** A packed rank back to its record: the one catalogue accessor (`../pages/prepare/catalogue.ts`). */
  const { recordOf } = createPageCatalogue(packedPages);
  let first = -1,
    free = new Int32Array(0),
    freeCount = 0,
    /** Casters that found no row, each once: what the table grows by. */
    short = 0;
  /** Casters waiting for a row, counted once however often they are followed (`short`). */
  const waiting = new Uint8Array(packedPages.length);
  let table: Float32Array | undefined,
    epoch = -1;
  /** The rows `[blendFirst, casterSlots)` of the table as it stands, all free; a caster that held
   *  one of a smaller table gives it back. */
  const seat = () => {
    const held = first >= 0;
    first = rows.blendFirst;
    free = new Int32Array(rows.casterSlots - first);
    freeCount = 0;
    short = 0;
    waiting.fill(0);
    // Popped from the end: the lowest row first.
    for (let row = rows.casterSlots - 1; row >= first; row--) free[freeCount++] = row;
    if (held)
      for (let page = 0; page < rows.blendRowOf.length; page++)
        if (rows.blendRowOf[page] >= 0) rows.blendRowOf[page] = -1;
  };
  seat();
  /** Seats the rows again when the table grew since: before any row is taken or written. */
  const followTable = () => {
    if (first !== rows.blendFirst || free.length !== rows.casterSlots - first) seat();
  };
  const write = (page: number, row: number, held: boolean) => {
    const rec = recordOf(page)!,
      ints = rows.pageTableInts!,
      coverage = row * ROW_WORDS + ROW_BLEND_COVERAGE_WORD,
      before = ints[coverage],
      wasTransmissive = rows.pageTableFloats![row * ROW_WORDS + ROW_TRANSMISSION_WORD] > 0;
    rows.packedRecs[row] = rec;
    rows.packedPageIndex[row] = page;
    const offsetWords = rows.residentOffsetWords[page];
    writePageRow(rec, page, row, offsetWords, rows.pageTableFloats!, ints);
    if (held && (ints[coverage] !== before || wasTransmissive || rec.material.transmission > 0))
      onCoverageChange(rec, page);
  };
  const release = (page: number, row: number) => {
    rows.blendRowOf[page] = -1;
    rows.packedRecs[row] = undefined;
    // A list built before the release may still name the row: it then draws no corner.
    rows.pageTableInts![row * ROW_WORDS + ROW_INDEX_WORDS] = 0;
    rows.markRowDirty(row);
    free[freeCount++] = row;
  };
  /**
   * Page `page`'s slot moved, arrived or left: its caster row follows. `restale` when the host
   * rewrote the surface, whose shadow then changes with its row — taken, given back or rewritten.
   */
  const follow = (page: number, restale = false) => {
    const rec = recordOf(page)!;
    if (!rec.transparent || !rows.pageTableInts) return;
    followTable();
    const row = rows.blendRowOf[page];
    if (waiting[page]) {
      waiting[page] = 0;
      short--;
    }
    // A cluster drawn from its geometry page holds no index page: its slot is all it needs.
    const casts =
      rows.residentOffsetWords[page] >= 0 &&
      !awaitsPageBytes(rec) &&
      (castsBlendShadow(rec.material) || !!rec.deformationOutput);
    if (!casts) {
      if (row < 0) return;
      release(page, row);
      if (restale) onCoverageChange(rec, page);
      return;
    }
    if (row >= 0) return write(page, row, restale);
    // Empty only past the rows the view holds (#1232): the table grows by the casters left out.
    if (!freeCount) {
      waiting[page] = 1;
      short++;
      return;
    }
    const taken = free[--freeCount];
    rows.blendRowOf[page] = taken;
    write(page, taken, false);
    if (restale) onCoverageChange(rec, page);
  };
  return {
    follow,
    /** Writes every row again when the table is new or its age moved; nothing otherwise. */
    refresh() {
      if (table === rows.pageTableFloats && epoch === rows.tableEpoch) return;
      followTable();
      // The same table at another age: the host rewrote a pose or a surface.
      const restale = table === rows.pageTableFloats;
      table = rows.pageTableFloats;
      epoch = rows.tableEpoch;
      if (!free.length) return;
      for (let page = 0; page < packedPages.length; page++) follow(page, restale);
    },
    /** Caster rows in use: what a list of casters can hold beyond the visibility rows. */
    get used() {
      return free.length - freeCount;
    },
    /** Caster rows asked: those in use and those that found none (`followCutRows`). */
    get asked() {
      return this.used + short;
    },
  };
}
