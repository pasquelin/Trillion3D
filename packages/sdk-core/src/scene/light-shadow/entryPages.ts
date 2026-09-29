import { LIGHT_KIND } from '../light/contracts.ts';
import type { ShadowRecords } from './records.ts';
import type { ShadowTable } from './table.ts';
import type { SunLevels } from './sunLevels.ts';
import { decodeLampEntry, lampCoarseness, sunCoarseness } from './pageModel.ts';

/**
 * WHAT A TABLE ENTRY NAMES, read back: its light view — a sun level, or a lamp face and mip as
 * `face · 16 + mip` — and its page — a sun's absolute page as the frame that named it laid the
 * clipmap out, a lamp face mip's own —, and how coarse that page is within its light. What a
 * request report (`requests.ts`) and the GPU allocator's pool (`mirror.ts`) are read through.
 */
export function createEntryPages(table: ShadowTable, records: ShadowRecords, sun: SunLevels) {
  const scratch = new Int32Array(4);
  const isSun = (slice: number) => records.kind[slice] === LIGHT_KIND.directional;
  return {
    isSun,
    /** Writes into `at` what `entry` of `slice` names in the layout of frame `frame`: false when
     *  that layout is no longer kept, or the clipmap has since left its page. */
    decode(entry: number, slice: number, frame: number, at: Int32Array) {
      const relative = entry - table.baseOf(slice);
      if (isSun(slice)) {
        if (!sun.decode(slice, relative, frame, scratch)) return false;
        if (!sun.holds(slice, scratch[0], scratch[1], scratch[2])) return false;
        for (let k = 0; k < 3; k++) at[k] = scratch[k];
        return true;
      }
      decodeLampEntry(relative, scratch);
      at[0] = scratch[0] * 16 + scratch[1];
      at[1] = scratch[2];
      at[2] = scratch[3];
      return true;
    },
    /** How coarse the page `at` names is within the light in `slice`. */
    rankOf: (slice: number, at: ArrayLike<number>) =>
      isSun(slice) ? sunCoarseness(at[0], sun.finest[slice]) : lampCoarseness(at[0] & 15),
  };
}

export type EntryPages = ReturnType<typeof createEntryPages>;
