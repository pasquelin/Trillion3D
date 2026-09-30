import type { ShadowPlan } from './plan.ts';
import { shadowPoolShape } from './virtual.ts';

/**
 * THE SHADOW POOL FOLLOWS WHAT THE SCENE ASKS, never the screen: a frame reads the pages its
 * pixels land on, at the size they are drawn, and the pool holds those of the report it keeps and
 * the next one's — twice a frame's read (`virtual.ts`) — with room to spare. A one-cube scene asks
 * a few hundred pages whatever the display; a screen of foliage asks thousands.
 */

/** The pool the first frame asks, before any report says what the scene reads: 16 × 16 pages, one
 *  2 048² texture. The first report sizes it (`demandPoolPages`). */
const SEED_POOL_PAGES = 256;
/** Pages a side of the seed pool. */
export const SEED_POOL_SIDE = shadowPoolShape(SEED_POOL_PAGES).side;
/** The pool a frame that reads `asked` pages grows to, over the two reports it holds: a quarter
 *  more, so a demand that grows by less than that resizes nothing. Declared, not derived: the
 *  headroom between two resizes, each one copy of every page kept (`poolResize.ts`). */
const HEADROOM = 1.25;

/** Pages the latest report read asked for: those of the pool it named, those it found no page for
 *  and those past its list. Nothing before any report. */
export function askedPages(plan: ShadowPlan) {
  const { pool, requests } = plan,
    latest = requests.latest;
  if (latest < 0) return 0;
  let named = 0;
  for (let page = 0; page < pool.pages; page++)
    if (pool.owner[page] >= 0 && pool.requested[page] >= latest) named++;
  return named + requests.counts.refused + requests.counts.unlisted;
}

/** The pool pages for a frame that asks `asked` pages: the two reports it holds, with headroom;
 *  never below the seed. */
export const demandPoolPages = (asked: number) =>
  Math.max(SEED_POOL_PAGES, Math.ceil(2 * HEADROOM * asked));

/** Reports in a row whose demand fits a pool half as large before it shrinks: a demand that dips
 *  for a moment never frees what the next turn of the camera asks again. Declared: about half a
 *  second at 120 frames a second, a report a frame. */
export const SHRINK_REPORTS = 60;

/** What the pool follows between reports: the last report weighed, how many in a row asked for a
 *  pool half as large, the most they asked, and whether the last one asked more than the pool
 *  holds (`over`). */
export const createPoolDemand = () => ({ latest: -1, low: 0, peak: 0, over: false });
export type PoolDemand = ReturnType<typeof createPoolDemand>;

/**
 * The pages the pool of `plan` is resized to after its latest report, or `undefined` to keep it.
 * It grows as soon as a report asks more than half of it — the two reports it holds would not fit
 * —, and shrinks once `SHRINK_REPORTS` reports in a row asked for a pool at most half as large, to
 * the most they asked. Each report is weighed once.
 */
export function followDemand(plan: ShadowPlan, demand: PoolDemand) {
  const latest = plan.requests.latest;
  if (latest < 0 || latest === demand.latest) return undefined;
  demand.latest = latest;
  const asked = askedPages(plan),
    pages = plan.pool.pages,
    wanted = demandPoolPages(asked);
  demand.over = 2 * asked > pages;
  if (demand.over || 2 * wanted > pages) {
    demand.low = demand.peak = 0;
    return demand.over ? wanted : undefined;
  }
  demand.peak = Math.max(demand.peak, wanted);
  if (++demand.low < SHRINK_REPORTS) return undefined;
  const peak = demand.peak;
  demand.low = demand.peak = 0;
  return peak;
}
