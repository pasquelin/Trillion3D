import { PAGE_FOOTPRINT_FULL, SHADOW_REQUEST_MISS, footprintUnion } from './footprint.ts';
import { STALE_FULL, type ShadowPool } from './pool.ts';
import type { ShadowRequestReport } from './requests.ts';
import type { ShadowTable } from './table.ts';
import { PAGE_INDEX_MASK, PAGE_MAPPED, SHADOW_TABLE_ENTRIES } from './virtual.ts';

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
 * THE RECEIVERS' FOOTPRINT OF EVERY PAGE THEY NAME (#1211): the early demand names a page for the
 * part of it the receivers' grown boxes cover (`demandSun.ts`, `demandLamp.ts`), and the page is
 * drawn for the union of those — its casters culled to it —, grown as new receivers name more.
 * A reader no box holds, whose texel the page misses, falls back meanwhile and says so in the
 * readback (`SHADOW_REQUEST_MISS`, `shadowPageWgsl.ts`): its page is then drawn whole. A frame
 * whose shading lights a surface no box holds (`ShadowReceivers.unboxed`) draws every page
 * whole. Allocates nothing past construction.
 */
export function createDemandFootprints(table: ShadowTable, pool: ShadowPool) {
  /** Each entry named this frame: the union of its receivers' footprints. */
  const named = new Uint8Array(SHADOW_TABLE_ENTRIES);
  let whole = false;
  const reach = (entry: number, footprint: number, nowMs: number, frame: number) => {
    const word = table.words[entry];
    if (!(word & PAGE_MAPPED)) return 0;
    return +reachFootprint(pool, word & PAGE_INDEX_MASK, footprint, nowMs, frame);
  };
  const footprints = {
    /** Current pages the frame staled for a footprint grown: the image cannot hold on them. */
    widened: 0,
    /** Opens a frame's naming: `unboxed`, every page is named whole. */
    begin(unboxed: boolean) {
      whole = unboxed;
    },
    /** `entry` named for `footprint`, the first time this frame when `first`. */
    name(entry: number, footprint: number, first: boolean) {
      if (whole) named[entry] = PAGE_FOOTPRINT_FULL;
      else named[entry] = first ? footprint : footprintUnion(named[entry], footprint);
    },
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
    /** The pages `demand` named, mapped now, grown to their receivers' footprint; a frame
     *  `unboxed`, every page mapped grown whole. */
    reachNamed(demand: ShadowRequestReport, nowMs: number, frame: number) {
      for (let i = 0, n = Math.min(demand.count, demand.entries.length); i < n; i++)
        footprints.widened += reach(demand.entries[i], named[demand.entries[i]], nowMs, frame);
      if (!whole) return;
      for (let page = 0; page < pool.pages; page++)
        if (pool.owner[page] >= 0)
          footprints.widened += +reachFootprint(pool, page, PAGE_FOOTPRINT_FULL, nowMs, frame);
    },
  };
  return footprints;
}
