import { PAGE_FOOTPRINT_SHIFT } from './footprint.ts';
import type { PageOps } from './pageOps.ts';
import {
  LAMP_MIPS,
  PAGE_INDEX_MASK,
  PAGE_MAPPED,
  PAGE_RANGE_SHIFT,
  PAGE_VALID,
  SHADOW_TABLE_ENTRIES,
  SUN_LEVELS,
} from './virtual.ts';

/** Ranks a key spans: every coarseness of either kind lies below it (`shadowSunCoarseness`). */
const RANK_SPAN = 128;
/** Pages a key spans: every page a table word names. */
export const PAGE_KEY_SPAN = PAGE_INDEX_MASK + 1;
/** A page asked more than this many frames ago is as old as any older one. */
export const AGE_CAP = 255;
// Every key is a non-negative `i32`: the shaders' and the scheduler's numbers are the same.
if (Math.max((SUN_LEVELS - 1) * LAMP_MIPS, (LAMP_MIPS - 1) * SUN_LEVELS) >= RANK_SPAN)
  throw new Error('SHADOW_RANK_SPAN');
if (
  RANK_SPAN * SHADOW_TABLE_ENTRIES > 2 ** 31 ||
  (AGE_CAP + 1) * RANK_SPAN * PAGE_KEY_SPAN > 2 ** 31
)
  throw new Error('SHADOW_KEY_SPAN');

/**
 * THE ORDERS OF THE POOL AND THE WORD OF A PAGE DRAWN (#1275), written once over `PageOps` like
 * the rest of the page model (`pageModel.ts`): the host's pool (`needs.ts`, `poolOrder.ts`, `pool.ts`)
 * and the GPU's allocation and seal (`allocWgsl.ts`, `freshWgsl.ts`) sort and write by the same
 * formulas.
 */
export function pageKeyModel<V>(o: PageOps<V>) {
  return {
    /** The order pages to map are served in: the coarsest first — a finer page falls back to it —,
     *  then by table entry, never the order a report listed them in. */
    shadowNeedKey: (rank: V, entry: V) =>
      o.add(o.mul(o.sub(o.int(RANK_SPAN - 1), rank), o.int(SHADOW_TABLE_ENTRIES)), entry),
    /** The order mapped pages not asked for this frame are taken in: the least recently asked first
     *  — `age` frames ago, at least one —, among those the finest first, then by page. A free page's
     *  key is its page alone, before all of them. */
    shadowEvictionKey: (age: V, rank: V, page: V) =>
      o.add(
        o.mul(
          o.add(
            o.mul(o.sub(o.int(AGE_CAP + 1), o.min(age, o.int(AGE_CAP))), o.int(RANK_SPAN)),
            rank,
          ),
          o.int(PAGE_KEY_SPAN),
        ),
        page,
      ),
    /** The table word of `page` drawn and readable: mapped, its depth range `range` (a sun's), the
     *  footprint it was drawn for (`footprint.ts`, zero whole). */
    shadowReadableWord: (page: V, range: V, footprintBits: V) =>
      o.add(
        o.add(
          o.add(page, o.int(PAGE_MAPPED | PAGE_VALID)),
          o.mul(range, o.int(2 ** PAGE_RANGE_SHIFT)),
        ),
        o.mul(footprintBits, o.int(2 ** PAGE_FOOTPRINT_SHIFT)),
      ),
  };
}
