import type { ShadowViewpoint } from '../light/contracts.ts';
import { createShadowNeeds } from './needs.ts';
import { createEntryPages } from './entryPages.ts';
import type { ShadowPoolSnapshot } from './mirror.ts';
import type { ShadowPool } from './pool.ts';
import type { ShadowRecords } from './records.ts';
import type { ShadowTable } from './table.ts';
import type { SunLevels } from './sunLevels.ts';
import { SHADOW_REQUEST_MISS } from './footprint.ts';
import {
  LAMP_FLOOR_MIP,
  PAGE_INDEX_MASK,
  PAGE_MAPPED,
  lampFacesOf,
  shadowRequestCap,
  sunFloorLevel,
} from './virtual.ts';
import { lampEntry, sunEntry } from './pageModel.ts';

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
  /** The GPU allocator's pool after that frame's allocation, when the GPU allocates. */
  pool?: ShadowPoolSnapshot;
}

/** Entries the host asks the GPU allocator for, beside what the pixels ask (`floors`).
 *  @property entries - The entries asked for, the first `count` of them at most.
 *  @property count - How many of `entries` are filled. */
export type ShadowAsks = { entries: Uint32Array; count: number };

/**
 * Reads a request report back: every page the shading asked for is either touched — mapped, it
 * becomes the most recently requested — or allocated. Allocation goes coarse first, then by
 * table entry: which pages a full pool refuses is the same every run, and a finer page falls
 * back to the coarser one under it (`shadowSunCoarseness`, `shadowLampCoarseness`).
 *
 * Every page named asks for its light's floor under it too (`sunFloorLevel`, `LAMP_FLOOR_MIP`),
 * mapped first and never evicted while anything above it is read. A sun asks every frame for the
 * floor pages its view reaches over the scene's box (`floors`); a new, moved or reshaped lamp,
 * for each face's until a report at its pose is read. A report against another layout, and a
 * sun entry whose page left the clipmap (`entryPages.ts`), are dropped.
 * When the GPU allocates (#1275), the report maps nothing: the GPU mapped what it names in that
 * frame, the pool follows its snapshot (`mirror.ts`), and every floor is asked of the GPU each frame.
 */
export function createShadowRequests(
  table: ShadowTable,
  pool: ShadowPool,
  records: ShadowRecords,
  sun: SunLevels,
  /** Entries read, allocated, refused for want of a page, and asked past the list (`unlisted`);
   *  a resized pool's requests go on counting where the old ones stopped. */
  counts = { requested: 0, allocated: 0, refused: 0, unlisted: 0, latest: -1 },
) {
  const cap = shadowRequestCap(pool.pages),
    needs = createShadowNeeds(table, pool, 2 * cap), // each entry named, and its floor
    entries = createEntryPages(table, records, sun),
    scratch = new Int32Array(4),
    /** What the entry being read names: its view, then its page. */
    at = new Int32Array(3);
  let reportFrame = -1,
    asking: ShadowAsks | undefined,
    heldCycle = -1; // The still cycle the request belongs to (`plan.ts`, #26)
  const { isSun } = entries;
  /** Touches `entry` when mapped, else notes it to allocate as `at` names it; asking, lists it. */
  const ask = (entry: number, slice: number) => {
    if (asking) {
      if (asking.count < asking.entries.length) asking.entries[asking.count++] = entry;
      return;
    }
    const word = table.words[entry];
    if (word & PAGE_MAPPED) {
      const page = word & PAGE_INDEX_MASK;
      pool.requested[page] = Math.max(pool.requested[page], reportFrame);
      pool.named[page] = heldCycle;
      return;
    }
    needs.note(entry, slice, at[0], at[1], at[2], entries.rankOf(slice, at));
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
      entry += sunEntry(at[0], at[1], at[2], sun.windowPages);
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
     * the list holds at least as many entries as the pool holds pages (`shadowRequestCap`).
     */
    get complete() {
      return !counts.allocated && (!counts.unlisted || pool.heldBy(counts.latest));
    },
    consume(report: ShadowRequestReport, nowMs: number, frame: number, cycle = report.frame) {
      // A report read back before a resize lists at most the old pool's cap.
      counts.requested = Math.min(report.count, cap, report.entries.length);
      counts.unlisted = report.count - counts.requested;
      counts.allocated = report.pool?.allocated ?? 0;
      counts.refused = report.pool?.refused ?? 0;
      if (report.layoutEpoch !== table.layoutEpoch) return;
      counts.latest = reportFrame = report.frame;
      heldCycle = cycle;
      if (report.pool) return;
      needs.clear();
      for (let i = 0; i < counts.requested; i++) {
        const entry = report.entries[i];
        if (entry >= SHADOW_REQUEST_MISS) continue; // a miss grows its page: `demandFootprint.ts`
        const word = table.words[entry];
        let slice: number;
        if (word & PAGE_MAPPED) {
          const page = word & PAGE_INDEX_MASK;
          slice = pool.slice[page];
          at[0] = pool.view[page];
          at[1] = pool.x[page];
          at[2] = pool.y[page];
        } else {
          slice = table.sliceAt(entry);
          if (slice < 0 || !entries.decode(entry, slice, reportFrame, at)) continue;
        }
        ask(entry, slice);
        askFloor(slice);
      }
      needs.allocate(reportFrame, nowMs, frame, counts, cycle);
    },
    /** Asks, as if the latest report named them, for the floor pages a reader may need that no
     *  report names yet: every sun's over the scene within the view's far distance
     *  (`sun.floorReach`), whatever moved, and each face's of a lamp posed after that report — new,
     *  moved or reshaped: what it named was read at a past pose. Evicts only what it did not name;
     *  the next may evict it. With `gpu`, lists them all, every lamp's, for the GPU to map. */
    floors(
      posed: ArrayLike<number>,
      view: ShadowViewpoint,
      nowMs: number,
      frame: number,
      cycle = counts.latest,
      gpu?: ShadowAsks,
    ) {
      reportFrame = counts.latest;
      heldCycle = cycle;
      asking = gpu;
      for (let slice = 0; slice < posed.length; slice++) {
        if (records.kind[slice] < 0) continue;
        if (!gpu && !isSun(slice) && posed[slice] <= counts.latest) continue;
        if (!gpu) needs.clear();
        if (isSun(slice)) {
          const level = sunFloorLevel(sun.finest[slice]);
          sun.floorReach(slice, view, scratch);
          for (let y = scratch[1]; y <= scratch[3]; y++)
            for (let x = scratch[0]; x <= scratch[2]; x++) {
              at[0] = level;
              at[1] = x;
              at[2] = y;
              ask(table.baseOf(slice) + sunEntry(level, x, y, sun.windowPages), slice);
            }
        } else
          for (let face = 0; face < lampFacesOf(records.kind[slice]); face++) {
            at[0] = face * 16;
            askFloor(slice);
          }
        if (!gpu) needs.allocate(reportFrame, nowMs, frame, counts, cycle);
      }
      asking = undefined;
    },
    reset() {
      counts.requested = counts.allocated = counts.refused = counts.unlisted = 0;
      counts.latest = -1;
    },
  };
}
