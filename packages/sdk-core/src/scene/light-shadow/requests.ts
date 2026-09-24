import { LIGHT_KIND, LIGHT_SETTINGS } from '../light/contracts.ts';
import type { ShadowPool } from './pool.ts';
import type { ShadowRecords } from './records.ts';
import type { ShadowTable } from './table.ts';
import type { SunLevels } from './sunLevels.ts';
import {
  LAMP_FLOOR_MIP,
  PAGE_INDEX_MASK,
  PAGE_MAPPED,
  decodeLampEntry,
  lampCoarseness,
  lampEntry,
  sunCoarseness,
  sunEntry,
  sunFloorLevel,
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
 * becomes the most recently requested — or allocated. Allocation goes coarse first, then by table
 * entry, so which pages a full pool refuses is the same from one run to the next: a sun's
 * higher levels and a lamp's higher mips cover the most pixels per page, and they are what a
 * finer page falls back to, so the pool never serves a fine page before the coarse one under it.
 * Coarseness is measured within each light (`sunCoarseness`, `lampCoarseness`), as admission
 * measures it: a sun level and a lamp mip are not the same count.
 *
 * Every page named asks for its light's floor under it too (`sunFloorLevel`, `LAMP_FLOOR_MIP`):
 * what a reader falls back to last when that page is withdrawn. So the floor is mapped first, never
 * evicted while anything above it is read, and drawn in the frame it goes stale (`admit.ts`).
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
  // Each entry named, and the floor under it.
  const needEntry = new Int32Array(2 * CAP),
    needSlice = new Int32Array(2 * CAP),
    needView = new Int32Array(2 * CAP),
    needX = new Int32Array(2 * CAP),
    needY = new Int32Array(2 * CAP),
    needRank = new Float64Array(2 * CAP),
    /** Allocation order: the coarsest first, then by table entry — never the report's order, the
     *  order the GPU's atomics appended the entries in. */
    order = new Int32Array(2 * CAP),
    scratch = new Int32Array(4),
    /** What the entry being read names: its view, then its page. */
    at = new Int32Array(3);
  let needs = 0,
    reportFrame = -1;
  const coarsestFirst = (a: number, b: number) =>
    needRank[b] - needRank[a] || needEntry[a] - needEntry[b] || a - b;
  /** Entries read, allocated, refused for want of a page, and asked past the list (`unlisted`). */
  const counts = { requested: 0, allocated: 0, refused: 0, unlisted: 0, latest: -1 };
  const isSun = (slice: number) => records.kind[slice] === LIGHT_KIND.directional;
  /** Touches `entry` when it is mapped; else notes it to allocate, as `at` names it. */
  const ask = (entry: number, slice: number) => {
    const word = table.words[entry];
    if (word & PAGE_MAPPED) {
      const page = word & PAGE_INDEX_MASK;
      pool.requested[page] = Math.max(pool.requested[page], reportFrame);
      return;
    }
    needEntry[needs] = entry;
    needSlice[needs] = slice;
    needView[needs] = at[0];
    needX[needs] = at[1];
    needY[needs] = at[2];
    needRank[needs] = isSun(slice)
      ? sunCoarseness(at[0], sun.finest[slice])
      : lampCoarseness(at[0] & 15);
    order[needs] = needs;
    needs++;
  };
  /** Writes into `at` what unmapped `entry` of `slice` names; false when the clipmap left it. */
  const decode = (entry: number, slice: number) => {
    const relative = entry - table.baseOf(slice);
    if (isSun(slice)) {
      if (!sun.decode(slice, relative, reportFrame, scratch)) return false;
      if (!sun.holds(slice, scratch[0], scratch[1], scratch[2])) return false;
      for (let k = 0; k < 3; k++) at[k] = scratch[k];
      return true;
    }
    decodeLampEntry(relative, scratch);
    at[0] = scratch[0] * 16 + scratch[1];
    at[1] = scratch[2];
    at[2] = scratch[3];
    return true;
  };
  /** Asks for the floor page under the page `at` names, unless it is that page. */
  const askFloor = (slice: number) => {
    let entry = table.baseOf(slice);
    if (isSun(slice)) {
      const floor = sunFloorLevel(sun.finest[slice]);
      if (at[0] >= floor) return;
      const scale = 2 ** (floor - at[0]);
      at[0] = floor;
      at[1] = Math.floor(at[1] / scale);
      at[2] = Math.floor(at[2] / scale);
      if (!sun.holds(slice, at[0], at[1], at[2])) return;
      entry += sunEntry(at[0], at[1], at[2]);
    } else {
      if ((at[0] & 15) === LAMP_FLOOR_MIP) return;
      entry += lampEntry(at[0] >> 4, LAMP_FLOOR_MIP, 0, 0);
      at[0] = (at[0] & ~15) | LAMP_FLOOR_MIP;
      at[1] = at[2] = 0;
    }
    ask(entry, slice);
  };
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
      counts.latest = reportFrame = report.frame;
      needs = 0;
      for (let i = 0; i < counts.requested; i++) {
        const entry = report.entries[i],
          word = table.words[entry];
        let slice: number;
        if (word & PAGE_MAPPED) {
          const page = word & PAGE_INDEX_MASK;
          slice = pool.slice[page];
          at[0] = pool.view[page];
          at[1] = pool.x[page];
          at[2] = pool.y[page];
        } else {
          slice = table.sliceAt(entry);
          if (slice < 0 || !decode(entry, slice)) continue;
        }
        ask(entry, slice);
        askFloor(slice);
      }
      if (!needs) return;
      order.subarray(0, needs).sort(coarsestFirst);
      pool.beginAllocation(report.frame);
      for (let k = 0; k < needs; k++) {
        const n = order[k];
        // A floor under several named pages is noted once for each.
        if (table.words[needEntry[n]] & PAGE_MAPPED) continue;
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
