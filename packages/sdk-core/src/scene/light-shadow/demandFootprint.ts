import { PAGE_FOOTPRINT_FULL, SHADOW_REQUEST_MISS, footprintUnion } from './footprint.ts';
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
function reachFootprint(
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
 * grown as new receivers name more. The exact per-pixel producer of that footprint is #1275; until
 * it lands the one producer is the miss signal: a reader that found its page drawn for a footprint
 * missing its texel falls back and says so in the readback (`SHADOW_REQUEST_MISS`,
 * `shadowPageWgsl.ts`), and the page is then drawn whole. Allocates nothing.
 */
export function createDemandFootprints(table: ShadowTable, pool: ShadowPool) {
  const reach = (entry: number, footprint: number, nowMs: number, frame: number) => {
    const word = table.words[entry];
    if (!(word & PAGE_MAPPED)) return 0;
    return +reachFootprint(pool, word & PAGE_INDEX_MASK, footprint, nowMs, frame);
  };
  const footprints = {
    /** Current pages the frame staled for a footprint grown: the image cannot hold on them. */
    widened: 0,
    /** Every page a reader of `read` found drawn for a footprint that misses its texel: whole. */
    missed(read: ShadowRequestReport, nowMs: number, frame: number) {
      if (read.layoutEpoch !== table.layoutEpoch) return;
      for (let i = 0, n = Math.min(read.count, read.entries.length); i < n; i++)
        if (read.entries[i] >= SHADOW_REQUEST_MISS)
          footprints.widened += reach(
            read.entries[i] - SHADOW_REQUEST_MISS,
            PAGE_FOOTPRINT_FULL,
            nowMs,
            frame,
          );
    },
  };
  return footprints;
}
