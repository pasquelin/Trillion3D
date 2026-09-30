import {
  SHADOW_REQUEST_CELL_MASK,
  SHADOW_REQUEST_CELL_SHIFT,
  SHADOW_REQUEST_ENTRY_MASK,
  SHADOW_REQUEST_MISS,
  cellFootprint,
  footprintUnion,
} from './footprint.ts';
import { STALE_FULL, type ShadowPool } from './pool.ts';
import type { ShadowRequestReport } from './requests.ts';
import type { ShadowTable } from './table.ts';
import { PAGE_INDEX_MASK, PAGE_MAPPED } from './virtual.ts';

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

/** The cell a request entry named: its stored code (0, a claim that named no texel). */
const cellOf = (entry: number) => (entry >> SHADOW_REQUEST_CELL_SHIFT) & SHADOW_REQUEST_CELL_MASK;

/**
 * THE RECEIVERS' FOOTPRINT OF EVERY PAGE THEY NAME (#1211): the part of a page its receivers
 * read, drawn for the union of what named it — its casters culled to it (`pageCompose.ts`) —,
 * grown as new receivers name more. The exact per-pixel producer is #1275's demand: each lit
 * pixel marks, per page, the cell of the page its shadow read takes (`demandWgsl.ts`,
 * `requestShadowPageAt`), a frame later read here. A reader the marks missed — outside the
 * footprint the page was drawn for — says so in its own readback (`SHADOW_REQUEST_MISS`,
 * `shadowPageWgsl.ts`), with the cell of its texel: the page grows by that cell, never whole, so
 * the union converges on the receivers' true footprint. Allocates nothing.
 */
export function createDemandFootprints(table: ShadowTable, pool: ShadowPool) {
  const reach = (entry: number, footprint: number, nowMs: number, frame: number) => {
    const word = table.words[entry & SHADOW_REQUEST_ENTRY_MASK];
    if (!(word & PAGE_MAPPED)) return 0;
    return +reachFootprint(pool, word & PAGE_INDEX_MASK, footprint, nowMs, frame);
  };
  const footprints = {
    /** Current pages the frame staled for a footprint grown: the image cannot hold on them. */
    widened: 0,
    /** Every page a reader of `read` named, by the cell of the texel it read: a per-pixel mark
     *  narrows its page to that cell (a page no receiver named is drawn whole), and a miss grows
     *  it by the cell the drawn footprint lacked. One pass, both. */
    read(read: ShadowRequestReport, nowMs: number, frame: number) {
      if (read.layoutEpoch !== table.layoutEpoch) return;
      for (let i = 0, n = Math.min(read.count, read.entries.length); i < n; i++) {
        const entry = read.entries[i],
          code = cellOf(entry);
        if (entry < SHADOW_REQUEST_MISS && !code) continue;
        footprints.widened += reach(entry, cellFootprint(code), nowMs, frame);
      }
    },
  };
  return footprints;
}
