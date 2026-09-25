import { MAX_SHADOW_SLICES } from '../light/contracts.ts';
import { RANKS, type ShadowPool } from './pool.ts';
import type { ShadowTable } from './table.ts';
import { ringOf } from './virtual.ts';

/** Light views a light holds, its sun levels or lamp faces and mips (`pool.view`). */
const LIGHT_VIEWS = 4096;
/** The light view a page is drawn in — its light, then its sun level or lamp face and mip: the
 *  pages of one view share one caster selection. */
const viewKeyOf = (pool: ShadowPool, page: number) =>
  pool.slice[page] * LIGHT_VIEWS + pool.view[page];
/** A page's place in the list: its coarseness, the coarsest first, then its light and view. A
 *  view has one rank: its pages stay contiguous. */
const listKeyOf = (pool: ShadowPool, page: number) =>
  ((RANKS / 2 - pool.rank[page]) * MAX_SHADOW_SLICES + pool.slice[page]) * LIGHT_VIEWS +
  pool.view[page];
/** Ages a sort key tells apart, so that every key stays an exact float, under 2^53, twice over:
 *  a floor's above every other page's. Far past the bound below. */
const AGES = 2048;

/** Host bytes the admission of a `pages`-page pool allocates: its list, view keys and sort keys. */
export const shadowAdmissionHostBytes = (pages: number) => pages * (4 + 4 + 8);

/**
 * THE PAGES A FRAME DRAWS: every stale page the latest request report named — what the image
 * reads now —, all of them, in the frame that marks them. There is no per-frame page cap, no
 * millisecond budget and no priority: the cost is held by caching — a page is drawn only once it
 * is marked, and it is marked only when what it holds changed (`invalidate.ts`) or it was just
 * mapped (`requests.ts`) —, and the pool is the only limit: what it cannot hold is refused at
 * allocation and published as memory (`requests.counts.refused`), never shown as current.
 *
 * A stale page nobody reads is not drawn: it costs nothing, and is drawn the frame someone asks for
 * it. It waits unreadable (`pool.withdraw`, the one staleness mechanism): a pass that reads without
 * asking — blend, water — would otherwise read its old depth for as long as no report names it.
 *
 * While nothing waits, the list holds the pages the coarsest first — every light's floor, what a
 * reader falls back to last, leading —, then light view by light view, each view's pages in page
 * order: what the light cut selects casters for once. The GPU draws it in the batches its
 * buffers hold (`batchEnd`), every batch in the frame. All arrays are allocated once.
 *
 * NO PAGE WAITS FOREVER. A frame that cannot draw the whole list — its batches past the most its
 * memory holds, a batch that cannot be encoded — stops at a page and leaves the rest pending
 * (`reset(stopped)`, `plan.reissue`). Until a frame draws its whole list again, the list orders
 * the pages by age first — the frames since each turned stale (`pool.sinceFrame`), the oldest
 * first, the floors ahead of the rest —, then as above. The pages ahead of a pending page are
 * floors, or turned stale before it or in its frame: no other page that turns stale later passes
 * it, whatever its view. A frame draws at least one page per batch, so, while the floors that turn
 * stale again each frame are fewer than the pages a frame draws, the others ahead are fewer each
 * frame, never more, and a page that stays read is drawn within ⌈pool pages / batches a frame
 * draws⌉ + 1 frames of being listed: 25 for the largest pool (4 096 pages, `MAX_SHADOW_BATCHES`
 * 171), when every batch holds one page.
 */
export function createShadowAdmission(poolPages: number) {
  const list = new Int32Array(poolPages),
    /** The light view of each listed page (`viewKeyOf`), read by the batch cut and the runs. */
    keys = new Int32Array(poolPages),
    /** One exact sort key per admitted page: its age, then `listKeyOf`, then the page. */
    order = new Float64Array(poolPages),
    /** A sort key's weight of one frame of age: a multiple of the pool's pages, past the span of
     *  list keys, a sun level negative or not. */
    ageWeight = poolPages * 2 * MAX_SHADOW_SLICES * RANKS * LIGHT_VIEWS;
  let count = 0,
    /** The last frame left pages pending: the next list puts the oldest first. */
    waiting = false;
  return {
    list,
    keys,
    hostBytes: list.byteLength + keys.byteLength + order.byteLength,
    get count() {
      return count;
    },
    /** Lists every stale page the report of frame `latest` named, at frame `frame`; returns how
     *  many. */
    run(
      pool: ShadowPool,
      table: ShadowTable,
      latest: number,
      frame: number,
      isFloor: (page: number) => boolean,
    ) {
      count = 0;
      for (let page = 0; page < pool.pages; page++) {
        if (pool.owner[page] < 0 || !pool.dirty[page]) continue;
        if (pool.requested[page] < latest) pool.withdraw(table, page);
        else {
          const floor = isFloor(page);
          const age = waiting ? Math.min(Math.max(0, frame - pool.sinceFrame[page]), AGES - 1) : 0;
          order[count++] =
            listKeyOf(pool, page) * poolPages + page - (floor ? AGES + age : age) * ageWeight;
        }
      }
      order.subarray(0, count).sort();
      // An empty list is drawn whole: nothing waits any more.
      if (!count) waiting = false;
      for (let i = 0; i < count; i++) {
        // A key is negative for its age or a negative sun level: the page is its remainder, taken
        // positive.
        list[i] = ringOf(order[i], poolPages);
        keys[i] = viewKeyOf(pool, list[i]);
      }
      return count;
    },
    /**
     * End of the batch that starts at `from`: at most `pages` pages, in at most `views` light
     * views — what the GPU's buffers and one light cut hold. A view may span two batches.
     */
    batchEnd(from: number, pages: number, views: number) {
      let opened = 0,
        to = from;
      for (; to < count && to - from < Math.max(1, pages); to++) {
        if (to > from && keys[to] === keys[to - 1]) continue;
        if (opened >= Math.max(1, views)) break;
        opened++;
      }
      return to;
    },
    /** Closes the list. The frame drew it up to `stopped`: what it left undrawn stays stale, and
     *  the next list is ordered by age. */
    reset(stopped = count) {
      waiting = stopped < count;
      count = 0;
    },
  };
}
