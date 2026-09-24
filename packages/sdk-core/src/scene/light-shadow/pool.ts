import { LIGHT_SETTINGS } from '../light/contracts.ts';
import { PAGE_MAPPED, PAGE_VALID } from './virtual.ts';
import type { ShadowTable } from './table.ts';

/** Ranks an ordering key spans, centred on zero: a page's coarseness steps lie far inside it. */
const RANKS = 1024;

/** How stale a page is: only its moving casters changed, or its static ones too. */
export const STALE_DYNAMIC = 1,
  STALE_FULL = 2;
/**
 * How a page is drawn. Without a static layer — no object has moved yet — every caster at once.
 * With one: the static casters into the static layer, then the page restored from it and the
 * moving casters drawn over (`full`); or the restore and the moving casters alone (`dynamic`).
 */
export const DRAW_ALL = 0,
  DRAW_FULL = 1,
  DRAW_DYNAMIC = 2;

/**
 * THE PHYSICAL PAGES of the shadow pool and what each one holds: the table entry that maps it,
 * the light and the virtual page it draws — a sun level and its absolute page, or a lamp face,
 * mip and page —, whether its depth is current, and the last request that read it.
 *
 * A page is taken from the free list, or from the page least recently requested; a page the
 * latest request report named is never taken. Only mapped pages can be stale, so the scheduler
 * walks this table — at most `pages` records — never the virtual one. Allocated once, `side ×
 * side` pages (`shadowPoolSide`).
 */
export function createShadowPool(side: number) {
  const pages = side * side;
  const owner = new Int32Array(pages).fill(-1),
    slice = new Int32Array(pages),
    /** Sun: level. Lamp: `face · 16 + mip`. */
    view = new Int32Array(pages),
    x = new Int32Array(pages),
    y = new Int32Array(pages),
    /** How coarse the page is within its light (`sunCoarseness`, `lampCoarseness`): the finer
     *  goes first. */
    rank = new Int32Array(pages),
    requested = new Int32Array(pages).fill(-1),
    dirty = new Uint8Array(pages),
    valid = new Uint8Array(pages),
    /** The static layer holds this page's static casters, current. */
    layered = new Uint8Array(pages),
    since = new Float64Array(pages),
    sinceFrame = new Int32Array(pages);
  const free = new Int32Array(pages),
    /** Eviction keys: last request, then rank, then page, packed into one exact number. */
    order = new Float64Array(pages);
  /** One bit per table entry: its page was evicted to make room, and it has not been drawn since. */
  const evicted = new Uint32Array(LIGHT_SETTINGS.shadowTableEntries / 32);
  let refetched = 0,
    freeCount = 0,
    orderCount = -1,
    orderAt = 0,
    orderFrame = -1;
  /** The evictable pages of the report of `orderFrame`, in eviction order: built by the first
   *  `take` the free list cannot serve, with one native numeric sort. */
  const buildOrder = () => {
    orderCount = 0;
    orderAt = 0;
    for (let page = 0; page < pages; page++)
      if (owner[page] >= 0 && requested[page] < orderFrame)
        order[orderCount++] =
          ((requested[page] + 1) * RANKS + rank[page] + RANKS / 2) * pages + page;
    order.subarray(0, orderCount).sort();
  };
  const init = () => {
    owner.fill(-1);
    requested.fill(-1);
    dirty.fill(0);
    valid.fill(0);
    layered.fill(0);
    for (let page = 0; page < pages; page++) free[page] = pages - 1 - page;
    freeCount = pages;
    evicted.fill(0);
    refetched = 0;
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
    layered,
    since,
    sinceFrame,
    /** Physical pages per side of the atlas, and in all. */
    side,
    pages,
    get used() {
      return pages - freeCount;
    },
    /** Entries mapped again after the pool evicted them: redraws the pool's size caused. */
    get refetched() {
      return refetched;
    },
    /**
     * The page is stale from now on — its moving casters only, or its static ones too —, at the
     * most of what it already was; its wait never restarts. True when it was current.
     */
    stale(page: number, nowMs: number, frame: number, level = STALE_FULL) {
      const was = dirty[page];
      if (was < level) dirty[page] = level;
      if (was) return false;
      since[page] = nowMs;
      sinceFrame[page] = frame;
      return true;
    },
    /** How the page is to be drawn, a static layer existing or not (`DRAW_*`). */
    drawMode(page: number, staticLayer: boolean) {
      if (!staticLayer) return DRAW_ALL;
      return dirty[page] === STALE_FULL || !layered[page] ? DRAW_FULL : DRAW_DYNAMIC;
    },
    /** The page's draw in `mode` has landed: current, and readable. */
    drew(table: ShadowTable, page: number, mode: number) {
      dirty[page] = 0;
      valid[page] = 1;
      layered[page] = mode === DRAW_FULL || (mode === DRAW_DYNAMIC && layered[page]) ? 1 : 0;
      table.write(owner[page], page | PAGE_MAPPED | PAGE_VALID);
    },
    /** The page keeps its place and its requests, but its depth is read no more until it is
     *  drawn again: a reader falls back to a coarser page meanwhile. */
    withdraw(table: ShadowTable, page: number) {
      if (!valid[page]) return;
      valid[page] = 0;
      table.write(owner[page], page | PAGE_MAPPED);
    },
    /** True when every page is taken and was asked for by the report of `reportFrame` or a later
     *  one: the pool can hold no more of what that report read. */
    heldBy(reportFrame: number) {
      if (freeCount) return false;
      for (let page = 0; page < pages; page++) if (requested[page] < reportFrame) return false;
      return true;
    },
    /** Unmaps the page: its entry reads nothing, and the page returns to the free list. */
    release(table: ShadowTable, page: number) {
      if (owner[page] < 0) return;
      table.write(owner[page], 0);
      owner[page] = -1;
      dirty[page] = 0;
      valid[page] = 0;
      layered[page] = 0;
      requested[page] = -1;
      free[freeCount++] = page;
    },
    /**
     * Pages that may be taken for a report of frame `reportFrame`: every mapped page no later
     * report named, least recently requested first and, among those, the finest first — a coarse
     * page is what the finer ones fall back to. Built once per report, by the first `take` the
     * free list cannot serve.
     */
    beginAllocation(reportFrame: number) {
      orderCount = -1;
      orderFrame = reportFrame;
    },
    /** A page for `entry`, asked by the report of `reportFrame`: a free one, else the oldest
     *  evictable one, else −1. It waits for its first draw from `frame`. */
    take(table: ShadowTable, entry: number, reportFrame: number, nowMs: number, frame: number) {
      let page = -1;
      if (freeCount) page = free[--freeCount];
      else {
        if (orderCount < 0) buildOrder();
        while (orderAt < orderCount && page < 0) {
          const candidate = order[orderAt++] % pages;
          const lost = owner[candidate];
          if (lost >= 0 && requested[candidate] < reportFrame) {
            evicted[lost >> 5] |= 1 << (lost & 31);
            pool.release(table, candidate);
            page = free[--freeCount];
          }
        }
      }
      if (page < 0) return -1;
      if (evicted[entry >> 5] & (1 << (entry & 31))) {
        evicted[entry >> 5] &= ~(1 << (entry & 31));
        refetched++;
      }
      owner[page] = entry;
      valid[page] = 0;
      layered[page] = 0;
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
