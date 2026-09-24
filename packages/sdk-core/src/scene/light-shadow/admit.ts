import { LIGHT_KIND, LIGHT_SETTINGS } from '../light/contracts.ts';
import type { ShadowBudget } from './budget.ts';
import type { ShadowPool } from './pool.ts';
import type { ShadowRecords } from './records.ts';
import type { ShadowTable } from './table.ts';
import type { SunLevels } from './sunLevels.ts';
import { LAMP_MIPS, SUN_LEVELS, lampCoarseness, sunCoarseness } from './virtual.ts';

/** The light view a page is drawn in — its light, then its sun level or lamp face and mip: the
 *  pages of one view share one caster selection. */
export const viewKeyOf = (pool: ShadowPool, page: number) =>
  pool.slice[page] * 4096 + pool.view[page];

/**
 * THE PAGES A FRAME DRAWS: stale pages the latest request report named — what the image reads
 * now —, by priority, until the millisecond budget or the buffer ceiling. A stale page nobody
 * reads waits, costs nothing, and is drawn the frame someone asks for it: that is what makes
 * the marking receiver-driven. It waits unreadable: a pass that reads without asking — blend,
 * water — would otherwise read its old depth for as long as no report names it.
 *
 * Priority: a page never drawn before one merely stale — the first reads a coarser level, the
 * second an older depth —, a coarse page before a fine one — it covers more pixels, and the
 * finer ones fall back to it —, and the wait already suffered, which rises frame by frame and
 * prevents starvation. The first page always passes: on a device whose single page exceeds the
 * budget, the wait would otherwise never end.
 *
 * How many pages is the budget's alone: its fixed milliseconds over the measured cost of a page.
 * What the light cut bounds is the light views a frame draws in (`setViewLimit`) — one view never
 * overflows its lists —, never the pages: a view takes every page the budget pays for. A stale page
 * the frame reads and does not draw is hidden once the frame's pages are committed
 * (`pool.hideStale`): the shading reads the next coarser current level, never its old depth. All
 * arrays are allocated once.
 */
export function createShadowAdmission(capacity: number, poolPages: number) {
  const candidates = new Int32Array(capacity),
    score = new Float64Array(poolPages),
    list = new Int32Array(capacity),
    views = new Float64Array(capacity);
  let count = 0,
    viewLimit = capacity;
  const coarseness = (records: ShadowRecords, sun: SunLevels, page: number, pool: ShadowPool) => {
    const slice = pool.slice[page];
    const steps =
      records.kind[slice] === LIGHT_KIND.directional
        ? sunCoarseness(pool.view[page], sun.finest[slice])
        : lampCoarseness(pool.view[page] & 15);
    return steps / (SUN_LEVELS * LAMP_MIPS);
  };
  return {
    list,
    get count() {
      return count;
    },
    /** Light views a frame may draw in (`setViewLimit`). */
    get viewLimit() {
      return viewLimit;
    },
    /** Picks this frame's pages into `list`; returns how many stale, asked-for pages remain. */
    run(
      pool: ShadowPool,
      table: ShadowTable,
      records: ShadowRecords,
      sun: SunLevels,
      budget: ShadowBudget,
      latest: number,
      frame: number,
    ) {
      count = 0;
      if (latest < 0) return 0;
      let found = 0,
        kept = 0;
      for (let page = 0; page < pool.pages; page++) {
        if (pool.owner[page] < 0 || !pool.dirty[page]) continue;
        if (pool.requested[page] < latest) {
          pool.withdraw(table, page);
          continue;
        }
        const value =
          (pool.valid[page] ? 0 : 1) +
          coarseness(records, sun, page, pool) +
          (frame - pool.sinceFrame[page]) * LIGHT_SETTINGS.shadowAgingPerFrame;
        score[page] = value;
        found++;
        // Only the best `capacity` can be drawn: kept in order, a tie behind the earlier page.
        let at = kept;
        if (kept === capacity) {
          if (!(value > score[candidates[kept - 1]])) continue;
          at--;
        } else kept++;
        for (; at > 0 && score[candidates[at - 1]] < value; at--)
          candidates[at] = candidates[at - 1];
        candidates[at] = page;
      }
      let spent = 0,
        opened = 0;
      for (let k = 0; k < kept; k++) {
        const cost = budget.estimate(1);
        if (cost !== null && count > 0 && spent + cost > budget.budgetMs) break;
        const key = viewKeyOf(pool, candidates[k]);
        let view = 0;
        while (view < opened && views[view] !== key) view++;
        if (view === opened) {
          if (opened === viewLimit) continue;
          views[opened++] = key;
        }
        spent += cost ?? 0;
        list[count++] = candidates[k];
      }
      return found - count;
    },
    reset() {
      count = 0;
    },
    /** Light views a frame may draw in from now on, at least one: fewer while the light cut drops
     *  work selecting for that many at once. */
    setViewLimit(count: number) {
      viewLimit = Math.max(1, Math.min(capacity, Math.floor(count)));
    },
  };
}
