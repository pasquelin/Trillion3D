import { PAGE_MAPPED, PAGE_VALID, POOL_PAGES } from './virtual.ts';
import type { ShadowTable } from './table.ts';

/**
 * THE PHYSICAL PAGES of the shadow pool and what each one holds: the table entry that maps it,
 * the light and the virtual page it draws — a sun level and its absolute page, or a lamp face,
 * mip and page —, whether its depth is current, and the last request that read it.
 *
 * A page is taken from the free list, or from the page least recently requested; a page the
 * latest request report named is never taken. Only mapped pages can be stale, so the scheduler
 * walks this table — at most `POOL_PAGES` records — never the virtual one. Allocated once.
 */
export function createShadowPool() {
  const owner = new Int32Array(POOL_PAGES).fill(-1),
    slice = new Int32Array(POOL_PAGES),
    /** Sun: level. Lamp: `face · 16 + mip`. */
    view = new Int32Array(POOL_PAGES),
    x = new Int32Array(POOL_PAGES),
    y = new Int32Array(POOL_PAGES),
    /** How coarse the page is within its light — a sun level, a lamp mip —: the finer goes first. */
    rank = new Int32Array(POOL_PAGES),
    requested = new Int32Array(POOL_PAGES).fill(-1),
    dirty = new Uint8Array(POOL_PAGES),
    valid = new Uint8Array(POOL_PAGES),
    since = new Float64Array(POOL_PAGES),
    sinceFrame = new Int32Array(POOL_PAGES);
  const free = new Int32Array(POOL_PAGES),
    order = new Int32Array(POOL_PAGES);
  let freeCount = 0,
    orderCount = 0,
    orderAt = 0;
  const init = () => {
    owner.fill(-1);
    requested.fill(-1);
    dirty.fill(0);
    valid.fill(0);
    for (let page = 0; page < POOL_PAGES; page++) free[page] = POOL_PAGES - 1 - page;
    freeCount = POOL_PAGES;
  };
  init();
  const pool = {
    owner,
    slice,
    view,
    x,
    y,
    rank,
    requested,
    dirty,
    valid,
    since,
    sinceFrame,
    get used() {
      return POOL_PAGES - freeCount;
    },
    /** The page is stale from now on, unless it already was: its wait never restarts. */
    stale(page: number, nowMs: number, frame: number) {
      if (dirty[page]) return false;
      dirty[page] = 1;
      since[page] = nowMs;
      sinceFrame[page] = frame;
      return true;
    },
    /** The page's draw has landed: current, and readable. */
    drew(table: ShadowTable, page: number) {
      dirty[page] = 0;
      valid[page] = 1;
      table.write(owner[page], page | PAGE_MAPPED | PAGE_VALID);
    },
    /** Unmaps the page: its entry reads nothing, and the page returns to the free list. */
    release(table: ShadowTable, page: number) {
      if (owner[page] < 0) return;
      table.write(owner[page], 0);
      owner[page] = -1;
      dirty[page] = 0;
      valid[page] = 0;
      requested[page] = -1;
      free[freeCount++] = page;
    },
    /**
     * Pages that may be taken for a report of frame `reportFrame`: every mapped page no later
     * report named, least recently requested first and, among those, the finest first — a coarse
     * page is what the finer ones fall back to. Built once per report, consumed by `take`.
     */
    beginAllocation(reportFrame: number) {
      orderCount = 0;
      orderAt = 0;
      for (let page = 0; page < POOL_PAGES; page++)
        if (owner[page] >= 0 && requested[page] < reportFrame) order[orderCount++] = page;
      order
        .subarray(0, orderCount)
        .sort((a, b) => requested[a] - requested[b] || rank[a] - rank[b]);
    },
    /** A page for `entry`, asked by the report of `reportFrame`: a free one, else the oldest
     *  evictable one, else −1. It waits for its first draw from `frame`. */
    take(table: ShadowTable, entry: number, reportFrame: number, nowMs: number, frame: number) {
      let page = -1;
      if (freeCount) page = free[--freeCount];
      else
        while (orderAt < orderCount && page < 0) {
          const candidate = order[orderAt++];
          if (owner[candidate] >= 0 && requested[candidate] < reportFrame) {
            pool.release(table, candidate);
            page = free[--freeCount];
          }
        }
      if (page < 0) return -1;
      owner[page] = entry;
      valid[page] = 0;
      dirty[page] = 0;
      pool.stale(page, nowMs, frame);
      requested[page] = reportFrame;
      table.write(entry, page | PAGE_MAPPED);
      return page;
    },
    reset: init,
  };
  return pool;
}

export type ShadowPool = ReturnType<typeof createShadowPool>;
