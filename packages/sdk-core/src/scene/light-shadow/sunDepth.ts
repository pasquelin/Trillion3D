import { MAX_SHADOW_SLICES } from '../light/contracts.ts';
import { SUN_DEPTH_RANGES as RANGES } from './virtual.ts';

/**
 * THE DEPTH RANGES OF EACH SUN (#991): the one its pages are drawn in now, and those older pages
 * were drawn in, `SUN_DEPTH_RANGES` slots of `zNear, zFar`.
 *
 * A page's depth is read in the range it was drawn in: its table word names the slot
 * (`PAGE_RANGE_SHIFT`), and the shading decodes it with that slot's pair. A new range therefore
 * leaves every page drawn in an older one right — each caster there lay in the range it was drawn
 * in, and a caster that moved stales its own pages (`invalidate.ts`) —; only the pages drawn from
 * now on take it. A range met again takes its slot back. A new one takes the slot least recently
 * current: the pages still drawn in it, if any, are withdrawn (`recycled`).
 */
export function createSunDepthRanges() {
  const pairs = new Float64Array(MAX_SHADOW_SLICES * RANGES * 2),
    /** Frame each slot was last current; −1 for a slot taken again without withdrawing a page. */
    used = new Int32Array(MAX_SHADOW_SLICES * RANGES).fill(-1),
    current = new Int32Array(MAX_SHADOW_SLICES),
    recycled = new Int32Array(MAX_SHADOW_SLICES).fill(-1);
  return {
    /** Each slice's slots, `zNear, zFar` each: what its record hands the shading. */
    pairs,
    /** The slot each slice draws its pages in now. */
    current,
    /** The slot the last `take` gave a new range while pages may still hold it, else −1. */
    recycled,
    /** A new frame: every page drawn in the old one is withdrawn, so no slot is held any more. */
    forget(slice: number) {
      used.fill(-1, slice * RANGES, (slice + 1) * RANGES);
    },
    /** `[zNear, zFar]` is the range `slice` draws its pages in at `frameIndex`. */
    take(slice: number, zNear: number, zFar: number, frameIndex: number) {
      const first = slice * RANGES,
        same = (k: number) =>
          used[first + k] >= 0 &&
          pairs[(first + k) * 2] === zNear &&
          pairs[(first + k) * 2 + 1] === zFar;
      recycled[slice] = -1;
      let slot = current[slice];
      if (!same(slot)) {
        let oldest = 0;
        for (slot = 0; slot < RANGES && !same(slot); slot++)
          if (used[first + slot] < used[first + oldest]) oldest = slot;
        if (slot === RANGES) {
          slot = oldest;
          if (used[first + slot] >= 0) recycled[slice] = slot;
          pairs[(first + slot) * 2] = zNear;
          pairs[(first + slot) * 2 + 1] = zFar;
        }
        current[slice] = slot;
      }
      used[first + slot] = frameIndex;
    },
  };
}

export type SunDepthRanges = ReturnType<typeof createSunDepthRanges>;
