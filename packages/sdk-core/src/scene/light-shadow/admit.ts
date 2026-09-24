import { LIGHT_KIND, LIGHT_SETTINGS } from '../light/contracts.ts';
import type { ShadowBudget } from './budget.ts';
import type { ShadowPool } from './pool.ts';
import type { ShadowRecords } from './records.ts';
import type { ShadowTable } from './table.ts';
import type { SunLevels } from './sunLevels.ts';
import { LAMP_MIPS, SUN_LEVELS, isFloorView, lampCoarseness, sunCoarseness } from './virtual.ts';

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
 * whose depth is wrong was withdrawn when it went stale (`pool.withdraw`): the shading reads the
 * next coarser current level, never its old depth. A page stale for detail, or for its moving
 * casters only, keeps being read until redrawn.
 *
 * **The floor is drawn in the frame.** A light's last level (`sunFloorLevel`, `LAMP_FLOOR_MIP`) is
 * what every finer page of it falls back to, and each report asks for the floor page under every
 * page it names (`requests.ts`): a floor page not read — never drawn, or withdrawn — is admitted
 * first, whatever the budget — the budget pays it before any finer page —, so a reader that falls
 * back never finds nothing. So is a floor stale at a past pose of its light: a move never withdraws
 * a floor (`invalidate.ts`), it stays read, a coarse shadow a few frames behind, until redrawn. A
 * floor still read, stale for its moving casters or for detail, waits its turn like any page:
 * redrawing it every frame something moves would starve the finer ones. Only the pool's ceiling
 * and the view limit can hold one back — when the frame's first floors exceed the one or span more
 * views than the light cut holds: an unread floor goes before a stale one a reader still falls back
 * to, then oldest first by their wait, so the one held back leads the next frame.
 *
 * **A moving light draws coarse first.** A finer page's wait counts from its light's pose (`posed`,
 * the frame the plan saw it claimed, moved or reshaped in), not from when it went stale: a page
 * was owed no draw at a pose already left, so a light moved every frame draws its pages coarsest
 * first within the budget — no finer page overtakes a coarser one by the frames it waited —, and
 * its finer pages come once it stops. Floors keep their whole wait: they take turns past the
 * limits. All arrays are allocated once.
 */
export function createShadowAdmission(capacity: number, poolPages: number) {
  /** Ranks an unread floor above every read one, whatever their waits. */
  const UNREAD_FLOOR = 2 ** 32;
  const candidates = new Int32Array(capacity),
    floors = new Int32Array(capacity),
    score = new Float64Array(poolPages),
    list = new Int32Array(capacity),
    views = new Float64Array(capacity);
  let count = 0,
    viewLimit = capacity,
    spent = 0,
    opened = 0;
  /** Adds `page` to the list, unless its view is one past the limit. */
  const admit = (pool: ShadowPool, page: number, cost: number) => {
    const key = viewKeyOf(pool, page);
    let view = 0;
    while (view < opened && views[view] !== key) view++;
    if (view === opened) {
      if (opened === viewLimit) return;
      views[opened++] = key;
    }
    spent += cost;
    list[count++] = page;
  };
  /** Ranks `page` of `value` into `into`, whose best `kept` pages it holds in descending order — a
   *  tie behind the earlier page —; returns how many it holds now. */
  const rank = (into: Int32Array, kept: number, page: number, value: number) => {
    score[page] = value;
    let at = kept;
    if (kept === capacity) {
      if (!(value > score[into[kept - 1]])) return kept;
      at--;
    } else kept++;
    for (; at > 0 && score[into[at - 1]] < value; at--) into[at] = into[at - 1];
    into[at] = page;
    return kept;
  };
  const coarseness = (records: ShadowRecords, sun: SunLevels, page: number, pool: ShadowPool) => {
    const slice = pool.slice[page];
    const steps =
      records.kind[slice] === LIGHT_KIND.directional
        ? sunCoarseness(pool.view[page], sun.finest[slice])
        : lampCoarseness(pool.view[page] & 15);
    return steps / (SUN_LEVELS * LAMP_MIPS);
  };
  const isFloor = (records: ShadowRecords, sun: SunLevels, page: number, pool: ShadowPool) => {
    const slice = pool.slice[page];
    const directional = records.kind[slice] === LIGHT_KIND.directional;
    return isFloorView(directional, pool.view[page], sun.finest[slice]);
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
      posed: ArrayLike<number>,
    ) {
      count = 0;
      let found = 0,
        kept = 0,
        unread = 0;
      spent = opened = 0;
      for (let page = 0; page < pool.pages; page++) {
        if (pool.owner[page] < 0 || !pool.dirty[page]) continue;
        if (pool.requested[page] < latest) {
          pool.withdraw(table, page);
          continue;
        }
        found++;
        const since = pool.sinceFrame[page],
          pose = posed[pool.slice[page]];
        // Only the best `capacity` can be drawn. A floor unread, or stale at a past pose, first:
        // the unread before the stale, which a reader still falls back to — then by their wait.
        if ((!pool.valid[page] || since <= pose) && isFloor(records, sun, page, pool))
          unread = rank(
            floors,
            unread,
            page,
            (pool.valid[page] ? 0 : UNREAD_FLOOR) + frame - since,
          );
        else
          kept = rank(
            candidates,
            kept,
            page,
            (pool.valid[page] ? 0 : 1) +
              coarseness(records, sun, page, pool) +
              (frame - Math.max(since, pose)) * LIGHT_SETTINGS.shadowAgingPerFrame,
          );
      }
      for (let k = 0; k < unread && count < capacity; k++)
        admit(pool, floors[k], budget.estimate(1) ?? 0);
      for (let k = 0; k < kept && count < capacity; k++) {
        const cost = budget.estimate(1);
        if (cost !== null && count > 0 && spent + cost > budget.budgetMs) break;
        admit(pool, candidates[k], cost ?? 0);
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
