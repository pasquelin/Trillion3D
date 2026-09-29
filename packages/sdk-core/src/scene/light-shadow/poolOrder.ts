import { PAGE_KEY_SPAN } from './pageKeys.ts';
import { PAGES } from './pageModel.ts';
import type { ShadowPageArrays } from './poolPages.ts';

/** Ranks an ordering key spans, centred on zero: a page's coarseness steps lie far inside it. */
export const RANKS = 1024;

/**
 * THE PAGES A REPORT MAY TAKE FROM ANOTHER ENTRY (`pool.ts`): every mapped page its cycle no
 * longer names (`named`) — at rest the cycle is the frame the rest began at, so a still scene's
 * jittering reports stop evicting each other and the pool refuses (#26) —, least recently requested
 * first and, among those, the finest first — a coarse page is what the finer ones fall back to —,
 * then by page: the GPU's order (`shadowEvictionKey`). Their keys are sorted once per report, by
 * the first page the free list cannot serve.
 */
export function createEvictionOrder() {
  let order = new Float64Array(0),
    count = -1,
    at = 0,
    frame = -1,
    evictBefore = -1;
  const build = (pool: ShadowPageArrays & { pages: number }) => {
    const { owner, requested, named, rank, pages } = pool;
    count = at = 0;
    for (let page = 0; page < pages; page++)
      if (owner[page] >= 0 && named[page] < evictBefore)
        order[count++] = PAGES.shadowEvictionKey(frame - requested[page], rank[page], page);
    order.subarray(0, count).sort();
  };
  return {
    /** Bytes of the keys it holds. */
    bytes: () => order.byteLength,
    /** Room for a pool of `pages`. */
    resize(pages: number) {
      order = new Float64Array(pages);
    },
    /** The pages a request of cycle `cycle` may take, read by the report of `reportFrame` — the
     *  frame ages are counted from —, sorted at the first `next`. */
    begin(cycle: number, reportFrame = cycle) {
      count = -1;
      evictBefore = cycle;
      frame = reportFrame;
    },
    /** The cycle begun: what a page it maps is named in. */
    cycle: () => evictBefore,
    /** The next page to evict for the report begun, still evictable, or −1. */
    next(pool: ShadowPageArrays & { pages: number }) {
      if (count < 0) build(pool);
      while (at < count) {
        const page = order[at++] % PAGE_KEY_SPAN;
        if (pool.owner[page] >= 0 && pool.named[page] < evictBefore) return page;
      }
      return -1;
    },
  };
}
