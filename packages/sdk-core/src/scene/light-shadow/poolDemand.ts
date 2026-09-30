import type { ShadowPlan } from './plan.ts';
import { shadowPoolShape } from './virtual.ts';
import { SHRINK_REPORTS } from './poolShrink.ts';

/**
 * THE SHADOW POOL FOLLOWS WHAT THE SCENE ASKS, never the screen: a frame reads the pages its
 * pixels land on, at the size they are drawn, and the pool holds those of the report it keeps and
 * the next one's — twice a frame's read (`virtual.ts`) — with room to spare. A one-cube scene asks
 * a few hundred pages whatever the display; a screen of foliage asks thousands.
 */

/** The host plan's pool before any grant — 16 × 16 pages —, and the least the demand sizes it to.
 *  The first grant is the budget's whole pool, as Unreal's `r.Shadow.Virtual.MaxPhysicalPages`
 *  allocates it up front (`webgpu/shadow/poolSize.ts`), and the first report sizes it. */
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

/** What the pool follows between reports: the last report weighed and the pages it asked, how
 *  many in a row asked for a pool half as large, the most they asked, whether the last one asked
 *  more than the pool holds (`over`), and whether a report sized the pool yet (`sized`). */
export const createPoolDemand = () => ({
  ...{ latest: -1, read: -1, low: 0, peak: 0 },
  ...{ over: false, sized: false },
});
export type PoolDemand = ReturnType<typeof createPoolDemand>;

/**
 * The pages the pool of `plan` is resized to after its latest report, or `undefined` to keep it.
 * The first report sizes the pool granted before it — the budget's, no demand yet — to what it
 * asked. Then it grows as soon as a report asks more than half of it — the two reports it holds
 * would not fit —, and shrinks once `SHRINK_REPORTS` reports in a row asked for a pool at most half
 * as large, to the most they asked; or at once under a view at rest (`resting`) whose report asks
 * as many pages as the one before — a scene at rest, which asks what it will keep asking and sends
 * no report once its image holds; a moving world under a still camera asks more, then fewer. Each
 * report is weighed once.
 */
export function followDemand(plan: ShadowPlan, demand: PoolDemand, resting = false) {
  const latest = plan.requests.latest;
  if (latest < 0 || latest === demand.latest) return undefined;
  demand.latest = latest;
  const asked = askedPages(plan),
    pages = plan.pool.pages,
    wanted = demandPoolPages(asked);
  demand.over = 2 * asked > pages;
  const quiet = resting && asked === demand.read;
  demand.read = asked;
  if (!demand.sized || (quiet && 2 * wanted <= pages)) {
    demand.sized = true;
    demand.low = demand.peak = 0;
    return wanted;
  }
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
