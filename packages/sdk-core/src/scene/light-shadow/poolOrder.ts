import type { ShadowPageArrays } from './poolPages.ts';

/** Ranks an ordering key spans, centred on zero: a page's coarseness steps lie far inside it. */
export const RANKS = 1024;

/**
 * THE PAGES A REPORT MAY TAKE FROM ANOTHER ENTRY (`pool.ts`): every mapped page no later report
 * named, least recently requested first and, among those, the finest first — a coarse page is what
 * the finer ones fall back to —, then by page. Their keys pack into one exact number each, sorted
 * once per report, by the first page the free list cannot serve.
 */
export function createEvictionOrder() {
  let order = new Float64Array(0),
    count = -1,
    at = 0,
    frame = -1;
  const build = (pool: ShadowPageArrays & { pages: number }) => {
    const { owner, requested, rank, pages } = pool;
    count = at = 0;
    for (let page = 0; page < pages; page++)
      if (owner[page] >= 0 && requested[page] < frame)
        order[count++] = ((requested[page] + 1) * RANKS + rank[page] + RANKS / 2) * pages + page;
    order.subarray(0, count).sort();
  };
  return {
    /** Bytes of the keys it holds. */
    bytes: () => order.byteLength,
    /** Room for a pool of `pages`. */
    resize(pages: number) {
      order = new Float64Array(pages);
    },
    /** The pages a report of frame `reportFrame` may take, sorted at the first `next`. */
    begin(reportFrame: number) {
      count = -1;
      frame = reportFrame;
    },
    /** The next page to evict for the report begun, still evictable, or −1. */
    next(pool: ShadowPageArrays & { pages: number }) {
      if (count < 0) build(pool);
      while (at < count) {
        const page = order[at++] % pool.pages;
        if (pool.owner[page] >= 0 && pool.requested[page] < frame) return page;
      }
      return -1;
    },
  };
}
