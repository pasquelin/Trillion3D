import { STALE_FULL, type ShadowPool } from './pool.ts';

/**
 * THE ERROR THRESHOLD EACH PAGE WAS DRAWN AT. The light cuts select casters at the camera's
 * threshold, budget included, and the budget raises it while the camera moves: a page drawn then
 * holds coarser casters than one drawn at rest. When the camera rests, only the pages drawn at
 * another threshold than the current one go stale — never every page because the threshold moved
 * and came back: a page drawn before the motion and not since is already what rest would draw.
 * A page staled so is coarser, not wrong: it stays read until redrawn.
 */
export function createShadowThresholds(pool: ShadowPool) {
  const drawnAt = new Float64Array(pool.pages).fill(NaN);
  let current = NaN,
    pending = false;
  return {
    /** The threshold this frame's light cuts select at. */
    set(threshold: number) {
      if (threshold === current) return;
      // The first threshold finds no page drawn at another.
      pending = !Number.isNaN(current);
      current = threshold;
    },
    /** True while the threshold moved and the pages drawn at another wait for the camera to rest. */
    get pending() {
      return pending;
    },
    /** Page `page` was drawn at the current threshold. */
    drew(page: number) {
      drawnAt[page] = current;
    },
    /** The camera rests: stales the mapped pages drawn at another threshold; returns how many. */
    restale(nowMs: number, frame: number) {
      if (!pending) return 0;
      pending = false;
      let staled = 0;
      for (let page = 0; page < pool.pages; page++) {
        const at = drawnAt[page];
        if (pool.owner[page] < 0 || Number.isNaN(at) || at === current) continue;
        if (pool.stale(page, nowMs, frame, STALE_FULL)) staled++;
      }
      return staled;
    },
    reset() {
      drawnAt.fill(NaN);
      pending = false;
    },
  };
}
