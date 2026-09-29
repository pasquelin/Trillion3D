import { PAGE_MAPPED, PAGE_RANGE_SHIFT, PAGE_VALID, SHADOW_TABLE_ENTRIES } from './virtual.ts';
import type { ShadowTable } from './table.ts';
import { shadowPageArrays, shadowPageArraysBytes } from './poolPages.ts';

/** Ranks an ordering key spans, centred on zero: a page's coarseness steps lie far inside it. */
export const RANKS = 1024;

/** How stale a page is: only its moving casters changed, or its static ones too. */
export const STALE_DYNAMIC = 1,
  STALE_FULL = 2;
/** How a page is drawn. Without a static layer — no object has moved yet — every caster at once.
 *  With one: the static casters into the layer, then the page restored from it and the moving
 *  casters over (`full`); or the restore and the moving casters alone (`dynamic`). */
export const DRAW_ALL = 0,
  DRAW_FULL = 1,
  DRAW_DYNAMIC = 2;

/** Host bytes a pool of `pages` allocates, per page 10·4 + 4 + 2·8, one bit per table entry. */
export const shadowPoolHostBytes = (pages: number) =>
  pages * (10 * 4 + 4 + 2 * 8) + SHADOW_TABLE_ENTRIES / 8;

/**
 * THE PHYSICAL PAGES of the shadow pool and what each one holds: the table entry that maps it,
 * the light and the virtual page it draws — a sun level and its absolute page, or a lamp face,
 * mip and page —, whether its depth is current, and the last request that read it.
 *
 * A page is taken from the free list, else from the least recently requested page the latest
 * report did not name. Only mapped pages go stale: the scheduler walks this table alone.
 */
export function createShadowPool(side: number, layers = 1) {
  let free = new Int32Array(0),
    /** Eviction keys: last request, then rank, then page, packed into one exact number. */
    order = new Float64Array(0),
    freeCount = 0,
    orderCount = -1,
    orderAt = 0,
    orderFrame = -1;
  /** One bit per table entry: its page was evicted to make room, and it has not been drawn since. */
  const evicted = new Uint32Array(SHADOW_TABLE_ENTRIES / 32);
  /** The evictable pages of the report of `orderFrame`, in eviction order: one sort, at need. */
  const buildOrder = () => {
    const { owner, requested, rank, pages } = pool;
    orderCount = 0;
    orderAt = 0;
    for (let page = 0; page < pages; page++)
      if (owner[page] >= 0 && requested[page] < orderFrame)
        order[orderCount++] =
          ((requested[page] + 1) * RANKS + rank[page] + RANKS / 2) * pages + page;
    order.subarray(0, orderCount).sort();
  };
  const init = () => {
    const { owner, requested, dirty, valid, layered, pages } = pool;
    owner.fill(-1);
    requested.fill(-1);
    for (const flags of [dirty, valid, layered]) flags.fill(0);
    for (let page = 0; page < pages; page++) free[page] = pages - 1 - page;
    freeCount = pages;
    evicted.fill(0);
    pool.refetched = 0;
  };
  /** `nextSide² × nextLayers` pages, every one of them free: the arrays are made anew. */
  const allocate = (nextSide: number, nextLayers: number) => {
    const pages = nextSide * nextSide * nextLayers;
    free = new Int32Array(pages);
    order = new Float64Array(pages);
    return { side: nextSide, layers: nextLayers, pages, ...shadowPageArrays(pages) };
  };
  // Data fields only, never an accessor: V8 keeps an object literal that has one in dictionary
  // mode, and every read of these arrays in a loop over the pool then costs a hash lookup (#26).
  const pool = {
    /** Physical pages per side of a layer, its layers (`shadowPoolShape`), and pages in all; then
     *  the page arrays. */
    ...allocate(side, layers),
    /** Bytes of every host array the pool holds: what `shadowPoolHostBytes` declares. */
    hostBytes: 0,
    /** Pages mapped. */
    used: () => pool.pages - freeCount,
    /** Entries mapped again after the pool evicted them: redraws the pool's size caused. */
    refetched: 0,
    /** Stale from now on (`STALE_*`), at most what it was; still mapped. True if it was current. */
    stale(page: number, nowMs: number, frame: number, level = STALE_FULL) {
      const was = pool.dirty[page];
      if (was < level) pool.dirty[page] = level;
      if (was) return false;
      pool.since[page] = nowMs;
      pool.sinceFrame[page] = pool.readFrame[page] = frame;
      return true;
    },
    /** How the page is drawn in depth-range slot `drawn` (`DRAW_*`): a layer of another is redrawn. */
    drawMode(page: number, staticLayer: boolean, drawn: number) {
      if (!staticLayer) return DRAW_ALL;
      const kept =
        pool.dirty[page] !== STALE_FULL && pool.layered[page] && pool.range[page] === drawn;
      return kept ? DRAW_DYNAMIC : DRAW_FULL;
    },
    /** The page's draw in `mode`, in depth-range slot `drawn`, has landed: current, readable. */
    drew(table: ShadowTable, page: number, mode: number, drawn: number) {
      pool.dirty[page] = 0;
      pool.valid[page] = 1;
      pool.layered[page] =
        mode === DRAW_FULL || (mode === DRAW_DYNAMIC && pool.layered[page]) ? 1 : 0;
      pool.range[page] = drawn;
      table.write(pool.owner[page], page | PAGE_MAPPED | PAGE_VALID | (drawn << PAGE_RANGE_SHIFT));
    },
    /** THE ONE WAY A PAGE IS READ NO MORE: it keeps its place and its requests, but its depth is
     *  wrong — not only coarser than the view wants — until it is drawn again, and a reader falls
     *  back to the next coarser current page meanwhile. */
    withdraw(table: ShadowTable, page: number) {
      if (!pool.valid[page]) return;
      pool.valid[page] = 0;
      table.write(pool.owner[page], page | PAGE_MAPPED);
    },
    /** True when every page is taken and was asked for by the report of `reportFrame` or a later
     *  one: the pool can hold no more of what that report read. */
    heldBy(reportFrame: number) {
      if (freeCount) return false;
      for (let page = 0; page < pool.pages; page++)
        if (pool.requested[page] < reportFrame) return false;
      return true;
    },
    /** Unmaps the page: its entry reads nothing, and the page returns to the free list. */
    release(table: ShadowTable, page: number) {
      if (pool.owner[page] < 0) return;
      table.write(pool.owner[page], 0);
      pool.owner[page] = -1;
      pool.dirty[page] = pool.valid[page] = pool.layered[page] = 0;
      pool.requested[page] = -1;
      free[freeCount++] = page;
    },
    /** Pages that may be taken for a report of frame `reportFrame`: every mapped page no later
     *  report named, least recently requested first and, among those, the finest first — a coarse
     *  page is what the finer ones fall back to. Built once per report, by the first `take` the
     *  free list cannot serve. */
    beginAllocation(reportFrame: number) {
      orderCount = -1;
      orderFrame = reportFrame;
    },
    /** A page for `entry`, asked by the report of `reportFrame`: a free one — the lowest first —,
     *  else the oldest evictable one, else −1. It waits for its first draw from `frame`. */
    take(table: ShadowTable, entry: number, reportFrame: number, nowMs: number, frame: number) {
      const { owner, requested } = pool;
      let page = -1;
      if (freeCount) page = free[--freeCount];
      else {
        if (orderCount < 0) buildOrder();
        while (orderAt < orderCount && page < 0) {
          const candidate = order[orderAt++] % pool.pages;
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
        pool.refetched++;
      }
      owner[page] = entry;
      pool.valid[page] = pool.layered[page] = pool.dirty[page] = 0;
      pool.stale(page, nowMs, frame);
      requested[page] = reportFrame;
      table.write(entry, page | PAGE_MAPPED);
      return page;
    },
    /** The pool of another size, empty — `poolResize.ts` carries what it held first —; its
     *  refetch count goes on. */
    resize(nextSide: number, nextLayers: number) {
      const refetched = pool.refetched;
      Object.assign(pool, allocate(nextSide, nextLayers));
      pool.hostBytes = hostBytesOf();
      init();
      pool.refetched = refetched;
    },
    reset: init,
  };
  const hostBytesOf = () =>
    shadowPageArraysBytes(pool) + free.byteLength + order.byteLength + evicted.byteLength;
  pool.hostBytes = hostBytesOf();
  init();
  return pool as Readonly<typeof pool>;
}

export type ShadowPool = ReturnType<typeof createShadowPool>;
