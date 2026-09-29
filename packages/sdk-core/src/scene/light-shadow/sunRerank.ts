import type { ShadowPool } from './pool.ts';
import type { ShadowTable } from './table.ts';
import type { SunLevels } from './sunLevels.ts';
import { sunCoarseness } from './virtual.ts';

/**
 * A page its level keeps is ranked again: a change of the finest level moves every level's
 * coarseness, and a view keeps one rank (`admit.ts`). A page its moved level no longer holds goes
 * back to the pool.
 */
export function rerankSunPages(
  pool: ShadowPool,
  table: ShadowTable,
  sun: SunLevels,
  slice: number,
) {
  for (let page = 0; page < pool.pages; page++) {
    if (pool.owner[page] < 0 || pool.slice[page] !== slice) continue;
    if (!sun.movedLevel(slice, pool.view[page])) continue;
    if (!sun.holds(slice, pool.view[page], pool.x[page], pool.y[page])) pool.release(table, page);
    else pool.rank[page] = sunCoarseness(pool.view[page], sun.finest[slice]);
  }
}
