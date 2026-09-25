import type { PageRec } from '../../page/selection/selection.ts';
import { PAGE_INFO_STRIDE } from '../../visibility/buffer.ts';
import { castsBlendShadow } from '../../gpu/shadow/blendCoverage.ts';
import { ROW_BLEND_COVERAGE_WORD, ROW_INDEX_WORDS, type createPageRowWriter } from './pageRow.ts';
import type { createWebgpuRowState } from './state.ts';

type Rows = ReturnType<typeof createWebgpuRowState>;
type Writer = ReturnType<typeof createPageRowWriter>;

/** The row-map word of a page that casts from no row: a rank no reader accepts. */
export const NO_ROW = 0xffffffff;
const ROW_WORDS = PAGE_INFO_STRIDE / 4;

/** Where the GPU light cut finds each page's row (`../../gpu/draw/lightRows.ts`). */
export interface BlendRowMap {
  pin(page: number, row: number): void;
}

export type BlendCasterRows = ReturnType<typeof createBlendCasterRows>;

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
 *
 * A row the host's rewrite of a surface takes, gives back or writes with another coverage calls
 * `onCoverageChange`: the shadow pages under the cluster no longer describe it. A row that follows
 * residency need not, since residency itself restales them.
 */
export function createBlendCasterRows(
  rows: Rows,
  packedPages: readonly PageRec[],
  writePageRow: Writer,
  onCoverageChange: (rec: PageRec) => void = () => {},
) {
  const { blendFirst, casterSlots, blendRowOf } = rows;
  const free = new Int32Array(casterSlots - blendFirst);
  let freeCount = 0;
  // Popped from the end: the lowest row first.
  for (let row = casterSlots - 1; row >= blendFirst; row--) free[freeCount++] = row;
  /** Pages whose row changed since the light cut's map last heard of them, each once. */
  const changed: number[] = [],
    marked = new Uint8Array(packedPages.length);
  let table: Float32Array | undefined,
    epoch = -1,
    map: BlendRowMap | undefined;
  const note = (page: number) => {
    if (marked[page]) return;
    marked[page] = 1;
    changed.push(page);
  };
  const write = (page: number, row: number, held: boolean) => {
    const rec = packedPages[page],
      ints = rows.pageTableInts!,
      coverage = row * ROW_WORDS + ROW_BLEND_COVERAGE_WORD,
      before = ints[coverage];
    rows.packedRecs[row] = rec;
    rows.packedPageIndex[row] = page;
    const offsetWords = rows.residentOffsetWords[page];
    writePageRow(rec, page, row, offsetWords, rows.pageTableFloats!, ints);
    if (held && ints[coverage] !== before) onCoverageChange(rec);
  };
  const release = (page: number, row: number) => {
    blendRowOf[page] = -1;
    rows.packedRecs[row] = undefined;
    // A list built before the release may still name the row: it then draws no corner.
    rows.pageTableInts![row * ROW_WORDS + ROW_INDEX_WORDS] = 0;
    rows.markRowDirty(row);
    free[freeCount++] = row;
    note(page);
  };
  /**
   * Page `page`'s slot moved, arrived or left: its caster row follows. `restale` when the host
   * rewrote the surface, whose shadow then changes with its row — taken, given back or rewritten.
   */
  const follow = (page: number, restale = false) => {
    const rec = packedPages[page];
    if (!rec.transparent || !rows.pageTableInts) return;
    const row = blendRowOf[page];
    const casts =
      rows.residentOffsetWords[page] >= 0 && !!rec.array && castsBlendShadow(rec.material);
    if (!casts) {
      if (row < 0) return;
      release(page, row);
      if (restale) onCoverageChange(rec);
      return;
    }
    if (row >= 0) return write(page, row, restale);
    // Never empty: every resident placement holds a pool slot, and `blendSlots` counts them all.
    if (!freeCount) return;
    const taken = free[--freeCount];
    blendRowOf[page] = taken;
    note(page);
    write(page, taken, false);
    if (restale) onCoverageChange(rec);
  };
  return {
    follow,
    /** Writes every row again when the table is new or its age moved; nothing otherwise. */
    refresh() {
      if (table === rows.pageTableFloats && epoch === rows.tableEpoch) return;
      // The same table at another age: the host rewrote a pose or a surface.
      const restale = table === rows.pageTableFloats;
      table = rows.pageTableFloats;
      epoch = rows.tableEpoch;
      if (!free.length) return;
      for (let page = 0; page < packedPages.length; page++) follow(page, restale);
    },
    /** Tells the light cut's map the rows that changed since — all of them, to a new map. */
    pin(to: BlendRowMap) {
      if (to !== map) {
        map = to;
        for (let page = 0; page < packedPages.length; page++)
          if (blendRowOf[page] >= 0) to.pin(page, blendRowOf[page]);
      } else
        for (const page of changed) to.pin(page, blendRowOf[page] >= 0 ? blendRowOf[page] : NO_ROW);
      for (const page of changed) marked[page] = 0;
      changed.length = 0;
    },
    /** Caster rows in use: what a list of casters can hold beyond the visibility rows. */
    get used() {
      return free.length - freeCount;
    },
  };
}
