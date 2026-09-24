import { LIGHT_KIND, LIGHT_SETTINGS } from '../light/contracts.ts';
import { RANKS, type ShadowPool } from './pool.ts';
import type { ShadowRecords } from './records.ts';
import type { ShadowTable } from './table.ts';
import type { SunLevels } from './sunLevels.ts';
import {
  PAGE_INDEX_MASK,
  PAGE_MAPPED,
  decodeLampEntry,
  lampCoarseness,
  sunCoarseness,
} from './virtual.ts';

/** What the shading read in one frame: the table entries it asked for, in no order. */
export interface ShadowRequestReport {
  /** Frame whose shading wrote the report. */
  frame: number;
  /** Table layout that frame read with (`ShadowTable.layoutEpoch`). */
  layoutEpoch: number;
  /** The plan's stamp when that frame was encoded (`ShadowPlan.stamp`). */
  stamp: number;
  /** Entries asked for, possibly more than `entries` holds: the rest ask again next frame. */
  count: number;
  /** The entries asked for, the first `count` of them at most. */
  entries: Uint32Array;
}

const CAP: number = LIGHT_SETTINGS.shadowRequestCap;

/**
 * Reads a request report back: every page the shading asked for is either touched — mapped, it
 * becomes the most recently requested — or allocated. Allocation goes coarse first: a sun's
 * higher levels and a lamp's higher mips cover the most pixels per page, and they are what a
 * finer page falls back to, so the pool never serves a fine page before the coarse one under it.
 * Coarseness is measured within each light (`sunCoarseness`, `lampCoarseness`), as admission
 * measures it: a sun level and a lamp mip are not the same count.
 *
 * A report read against another table layout is dropped: its words name ranges that moved. A
 * sun entry is read with the extents of the frame that wrote it, and dropped when its page has
 * since left the clipmap. Allocates nothing past construction.
 */
export function createShadowRequests(
  table: ShadowTable,
  pool: ShadowPool,
  records: ShadowRecords,
  sun: SunLevels,
) {
  const needEntry = new Int32Array(CAP),
    needSlice = new Int32Array(CAP),
    needView = new Int32Array(CAP),
    needX = new Int32Array(CAP),
    needY = new Int32Array(CAP),
    needRank = new Float64Array(CAP),
    /** Allocation keys: the coarsest first, then in report order, packed into one number. */
    order = new Float64Array(CAP),
    scratch = new Int32Array(4);
  /** Entries read, allocated, refused for want of a page, and asked past the list (`unlisted`). */
  const counts = { requested: 0, allocated: 0, refused: 0, unlisted: 0, latest: -1 };
  return {
    counts,
    /** Frame of the latest report read: the pages it named are the ones the image reads now. */
    get latest() {
      return counts.latest;
    },
    /**
     * True when the last report read changed nothing and asks for nothing the pool could still
     * take. A refusal is such a request: a page is refused only when every page of the pool is
     * one the report named. So is an entry past the list, once the named ones fill the pool —
     * the list holds at least as many entries as the pool holds pages (`shadowPoolSide`).
     */
    get complete() {
      return !counts.allocated && (!counts.unlisted || pool.heldBy(counts.latest));
    },
    consume(report: ShadowRequestReport, nowMs: number, frame: number) {
      counts.requested = Math.min(report.count, CAP);
      counts.unlisted = report.count - counts.requested;
      counts.allocated = 0;
      counts.refused = 0;
      if (report.layoutEpoch !== table.layoutEpoch) return;
      counts.latest = report.frame;
      let needs = 0;
      for (let i = 0; i < counts.requested; i++) {
        const entry = report.entries[i],
          word = table.words[entry];
        if (word & PAGE_MAPPED) {
          const page = word & PAGE_INDEX_MASK;
          pool.requested[page] = Math.max(pool.requested[page], report.frame);
          continue;
        }
        const slice = table.sliceAt(entry);
        if (slice < 0) continue;
        const relative = entry - table.baseOf(slice);
        if (records.kind[slice] === LIGHT_KIND.directional) {
          if (!sun.decode(slice, relative, report.frame, scratch)) continue;
          if (!sun.holds(slice, scratch[0], scratch[1], scratch[2])) continue;
          needView[needs] = scratch[0];
          needX[needs] = scratch[1];
          needY[needs] = scratch[2];
          needRank[needs] = sunCoarseness(scratch[0], sun.finest[slice]);
        } else {
          decodeLampEntry(relative, scratch);
          needView[needs] = scratch[0] * 16 + scratch[1];
          needX[needs] = scratch[2];
          needY[needs] = scratch[3];
          needRank[needs] = lampCoarseness(scratch[1]);
        }
        needEntry[needs] = entry;
        needSlice[needs] = slice;
        order[needs] = (RANKS / 2 - needRank[needs]) * CAP + needs;
        needs++;
      }
      if (!needs) return;
      order.subarray(0, needs).sort();
      pool.beginAllocation(report.frame);
      for (let k = 0; k < needs; k++) {
        const n = order[k] % CAP;
        const page = pool.take(table, needEntry[n], report.frame, nowMs, frame);
        if (page < 0) {
          counts.refused += needs - k;
          return;
        }
        pool.slice[page] = needSlice[n];
        pool.view[page] = needView[n];
        pool.x[page] = needX[n];
        pool.y[page] = needY[n];
        pool.rank[page] = needRank[n];
        counts.allocated++;
      }
    },
    reset() {
      counts.requested = counts.allocated = counts.refused = counts.unlisted = 0;
      counts.latest = -1;
    },
  };
}
