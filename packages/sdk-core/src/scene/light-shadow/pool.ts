import { PAGE_MAPPED, SHADOW_TABLE_ENTRIES } from './virtual.ts';
import { PAGES } from './pageModel.ts';
import type { ShadowTable } from './table.ts';
import { shadowPageArrays, shadowPageArraysBytes } from './poolPages.ts';
import { PAGE_FOOTPRINT_EMPTY, footprintDrawn } from './footprint.ts';
import { createEvictionOrder } from './poolOrder.ts';

export { RANKS } from './poolOrder.ts';

/** How stale a page is: only its moving casters changed, or its static ones too. */
export const STALE_DYNAMIC = 1,
  STALE_FULL = 2;
/** How a page is drawn. Without a static layer — no object has moved yet — every caster at once.
 *  With one: the static casters into the layer, then the page restored from it and the moving
 *  casters over (`full`); or the restore and the moving casters alone (`dynamic`). */
export const DRAW_ALL = 0,
  DRAW_FULL = 1,
  DRAW_DYNAMIC = 2;

/** Host bytes a pool of `pages` allocates, per page 11·4 + 5 + 2·8, one bit per table entry. */
export const shadowPoolHostBytes = (pages: number, tableEntries = SHADOW_TABLE_ENTRIES) =>
  pages * (11 * 4 + 5 + 2 * 8) + tableEntries / 8;

/**
 * THE PHYSICAL PAGES of the shadow pool and what each one holds: the table entry that maps it,
 * the light and the virtual page it draws — a sun level and its absolute page, or a lamp face,
 * mip and page —, whether its depth is current, and the last request that read it.
 *
 * A page is taken from the free list, else from the least recently requested page the latest
 * report did not name. Only mapped pages go stale: the scheduler walks this table alone.
 */
export function createShadowPool(side: number, layers = 1, tableEntries = SHADOW_TABLE_ENTRIES) {
  let free = new Int32Array(0),
    freeCount = 0;
  const order = createEvictionOrder();
  /** One bit per table entry: its page was evicted to make room, and it has not been drawn since. */
  const evicted = new Uint32Array(tableEntries / 32);
  const init = () => {
    const { owner, requested, named, dirty, valid, layered } = pool;
    owner.fill(-1);
    requested.fill(-1);
    named.fill(-1);
    for (const flags of [dirty, valid, layered]) flags.fill(0);
    pool.rebuildFree();
    evicted.fill(0);
    pool.refetched = 0;
  };
  /** `nextSide² × nextLayers` pages, every one of them free: the arrays are made anew. */
  const allocate = (nextSide: number, nextLayers: number) => {
    const pages = nextSide * nextSide * nextLayers;
    free = new Int32Array(pages);
    order.resize(pages);
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
    /** The page's draw in `mode`, in depth-range slot `drawn`, for `footprint` (`footprint.ts`)
     *  — the receivers' it holds by default —, has landed: current, readable there. The
     *  receivers' union is kept as it is (`PAGE_FOOTPRINT_EMPTY` until one names it): the page a
     *  receiver names after this draw still narrows it (`demandFootprint.ts`). */
    drew(table: ShadowTable, page: number, mode: number, drawn: number, footprint?: number) {
      const union = footprint ?? pool.footprint[page];
      pool.dirty[page] = 0;
      pool.valid[page] = 1;
      pool.layered[page] =
        mode === DRAW_FULL || (mode === DRAW_DYNAMIC && pool.layered[page]) ? 1 : 0;
      pool.range[page] = drawn;
      pool.footprint[page] = union;
      table.write(pool.owner[page], PAGES.shadowReadableWord(page, drawn, footprintDrawn(union)));
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
    /** Unmaps the page: its entry reads nothing, and the page returns to the free list. An evicted
     *  entry mapped again counts as a refetch. */
    release(table: ShadowTable, page: number, evict = false) {
      const lost = pool.owner[page];
      if (lost < 0) return;
      if (evict) evicted[lost >> 5] |= 1 << (lost & 31);
      table.write(lost, 0);
      pool.owner[page] = -1;
      pool.dirty[page] = pool.valid[page] = pool.layered[page] = 0;
      pool.requested[page] = -1;
      pool.named[page] = -1;
      free[freeCount++] = page;
    },
    /** Pages that may be taken for a request of cycle `cycle`, read by the report of
     *  `reportFrame`: every mapped page the cycle no longer names (`poolOrder.ts`, #26). */
    beginAllocation: order.begin,
    /** A page for `entry`, asked by the report of `reportFrame`: a free one — the lowest first —,
     *  else the oldest evictable one, else −1. It waits for its first draw from `frame`. */
    take(table: ShadowTable, entry: number, reportFrame: number, nowMs: number, frame: number) {
      let page = freeCount ? free[--freeCount] : -1;
      const lost = page < 0 ? order.next(pool) : -1;
      if (lost >= 0) {
        pool.release(table, lost, true);
        page = free[--freeCount];
      }
      if (page < 0) return -1;
      pool.adopt(table, page, entry, reportFrame, nowMs, frame);
      pool.named[page] = order.cycle();
      return page;
    },
    /** Free `page` maps `entry` — out of the free list, which the caller rebuilds —, asked by the
     *  report of `reportFrame`; it waits for its first draw from `frame`. */
    adopt(
      table: ShadowTable,
      page: number,
      entry: number,
      reportFrame: number,
      nowMs: number,
      frame: number,
    ) {
      if (evicted[entry >> 5] & (1 << (entry & 31))) {
        evicted[entry >> 5] &= ~(1 << (entry & 31));
        pool.refetched++;
      }
      pool.owner[page] = entry;
      pool.valid[page] = pool.layered[page] = pool.dirty[page] = 0;
      pool.footprint[page] = PAGE_FOOTPRINT_EMPTY;
      pool.stale(page, nowMs, frame);
      pool.requested[page] = reportFrame;
      table.write(entry, page | PAGE_MAPPED);
    },
    /** The free list anew, the pages no entry maps, the lowest handed out first (`mirror.ts`). */
    rebuildFree() {
      freeCount = 0;
      for (let page = pool.pages - 1; page >= 0; page--)
        if (pool.owner[page] < 0) free[freeCount++] = page;
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
    shadowPageArraysBytes(pool) + free.byteLength + order.bytes() + evicted.byteLength;
  pool.hostBytes = hostBytesOf();
  init();
  return pool as Readonly<typeof pool>;
}

export type ShadowPool = ReturnType<typeof createShadowPool>;
