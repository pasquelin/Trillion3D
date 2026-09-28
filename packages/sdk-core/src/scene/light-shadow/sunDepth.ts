import { MAX_SHADOW_SLICES } from '../light/contracts.ts';
import { STALE_FULL, type ShadowPool } from './pool.ts';
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
 *
 * Once the scene rests, the pages drawn in another range than the current one are drawn again in
 * it (`restale`), read meanwhile: a scene at rest shows the image one range draws, whatever ranges
 * its motion went through, and a moving scene redraws only what moved.
 */
export function createSunDepthRanges() {
  const pairs = new Float64Array(MAX_SHADOW_SLICES * RANGES * 2),
    /** Frame each slot was last current; −1 for a slot no readable page holds: never taken, or
     *  forgotten on a turn of the sun. */
    used = new Int32Array(MAX_SHADOW_SLICES * RANGES).fill(-1),
    current = new Int32Array(MAX_SHADOW_SLICES),
    recycled = new Int32Array(MAX_SHADOW_SLICES).fill(-1),
    /** The slice changed its current slot since the scene last rested. */
    pending = new Uint8Array(MAX_SHADOW_SLICES);
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
      pending[slice] = 0;
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
        if (slot !== current[slice]) pending[slice] = 1;
        current[slice] = slot;
      }
      used[first + slot] = frameIndex;
    },
    /** The scene rests: stales the mapped pages each sun drew in another slot than its current
     *  one, still read until redrawn; returns how many. */
    restale(pool: ShadowPool, nowMs: number, frame: number) {
      if (!pending.includes(1)) return 0;
      let staled = 0;
      for (let page = 0; page < pool.pages; page++) {
        const slice = pool.slice[page];
        if (pool.owner[page] < 0 || !pending[slice] || pool.range[page] === current[slice])
          continue;
        if (pool.stale(page, nowMs, frame, STALE_FULL)) staled++;
      }
      pending.fill(0);
      return staled;
    },
  };
}
