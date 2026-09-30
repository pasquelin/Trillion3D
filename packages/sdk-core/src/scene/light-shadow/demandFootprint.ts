import {
  PAGE_FOOTPRINT_EMPTY,
  PAGE_FOOTPRINT_FULL,
  SHADOW_REQUEST_MISS,
  cellsFootprint,
  footprintUnion,
} from './footprint.ts';
import { STALE_FULL, type ShadowPool } from './pool.ts';
import type { ShadowRequestReport } from './requests.ts';
import type { ShadowTable } from './table.ts';
import { PAGE_INDEX_MASK, PAGE_MAPPED } from './virtual.ts';

/** What a report says of the cells its readers took (#1211). */
export interface ShadowCellReport {
  /** The frame's cell table (`shadowCellWords`): its overflow word — nonzero when a mark found no
   *  slot, the masks partial —, then pairs of a key, the entry plus one, and its cell mask. */
  cells?: Uint32Array;
  /** The frame lit a blend or water surface: a reader that marks no cell, on any page. */
  transparent?: boolean;
}

/**
 * THE ONE WAY A PAGE'S FOOTPRINT GROWS: to its union with `footprint`, never less — a reader it
 * covered stays covered while the page is mapped. A drawn page it grows is stale in full, its
 * static layer too, for their casters were culled to the old one (`pages.ts`). True when that
 * staled a current page.
 */
export function reachFootprint(
  pool: ShadowPool,
  page: number,
  footprint: number,
  nowMs: number,
  frame: number,
) {
  const next = footprintUnion(pool.footprint[page], footprint);
  if (next === pool.footprint[page]) return false;
  pool.footprint[page] = next;
  return !!pool.valid[page] && pool.stale(page, nowMs, frame, STALE_FULL);
}

/**
 * THE RECEIVERS' FOOTPRINT OF EVERY PAGE THEY NAME (#1211): the part of a page its receivers
 * read, drawn for the union of what named it — its casters culled to it (`pageCompose.ts`) —,
 * grown as new receivers name more. The exact per-pixel producer is #1275's demand: each lit
 * pixel sets, in the frame's cell table, the cell of every page its shadow read takes
 * (`demandWgsl.ts`, `requestShadowPageAt`), and a reader outside the footprint a page was drawn
 * for sets the cell it missed (`requestShadowMiss`, `shadowPageWgsl.ts`); a frame later the whole
 * mask of each page is read here, every cell of every reader.
 *
 * A page drawn whole — no receiver named it yet — narrows only from a whole frame's masks: never
 * from a table that overflowed, nor while a blend or water surface, which marks nothing, is lit;
 * then every narrowed page is drawn whole again, and an overflow grows each page a reader missed
 * whole (`SHADOW_REQUEST_MISS`). Allocates nothing.
 */
export function createDemandFootprints(table: ShadowTable, pool: ShadowPool) {
  const pageOf = (entry: number) => {
    const word = table.words[entry];
    return word & PAGE_MAPPED ? word & PAGE_INDEX_MASK : -1;
  };
  const footprints = {
    /** Current pages the frame staled for a footprint grown: the image cannot hold on them. */
    widened: 0,
    /** Every page a reader of `read` took, grown by the cells it read (`ShadowCellReport`). */
    read(read: ShadowRequestReport, nowMs: number, frame: number) {
      if (read.layoutEpoch !== table.layoutEpoch) return;
      const grow = (page: number, footprint: number) =>
        (footprints.widened += +reachFootprint(pool, page, footprint, nowMs, frame));
      if (read.transparent) {
        for (let page = 0; page < pool.pages; page++)
          if (pool.footprint[page] !== PAGE_FOOTPRINT_EMPTY) grow(page, PAGE_FOOTPRINT_FULL);
        return;
      }
      const cells = read.cells;
      if (!cells) return;
      const partial = cells[0] !== 0;
      for (let i = 1; i + 1 < cells.length; i += 2) {
        const page = cells[i] && cells[i + 1] ? pageOf(cells[i] - 1) : -1;
        if (page < 0 || (partial && pool.footprint[page] === PAGE_FOOTPRINT_EMPTY)) continue;
        grow(page, cellsFootprint(cells[i + 1]));
      }
      if (!partial) return;
      for (let i = 0, n = Math.min(read.count, read.entries.length); i < n; i++) {
        const page =
          read.entries[i] >= SHADOW_REQUEST_MISS
            ? pageOf(read.entries[i] - SHADOW_REQUEST_MISS)
            : -1;
        if (page >= 0) grow(page, PAGE_FOOTPRINT_FULL);
      }
    },
  };
  return footprints;
}
