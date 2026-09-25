import { MAX_SHADOW_SLICES } from '../light/contracts.ts';
import type { ShadowPool } from './pool.ts';
import type { ShadowTable } from './table.ts';
import { ringOf } from './virtual.ts';

/** Light views a light holds, its sun levels or lamp faces and mips (`pool.view`). */
const LIGHT_VIEWS = 4096;
/** The light view a page is drawn in — its light, then its sun level or lamp face and mip: the
 *  pages of one view share one caster selection. */
const viewKeyOf = (pool: ShadowPool, page: number) =>
  pool.slice[page] * LIGHT_VIEWS + pool.view[page];
/** The span of view keys, a sun level negative or not. */
const VIEW_KEYS = 2 * MAX_SHADOW_SLICES * LIGHT_VIEWS;
/** The most frames a page's age counts: past any bound a frame of one-page batches reaches. Its
 *  heaviest sort key, of the largest pool (4 096 pages), stays exact: under 2^53. */
const MAX_AGE = 4095;

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
 * The list holds the pages light view by light view, each view's pages in page order: what the
 * light cut selects casters for once. The GPU draws it in the batches its buffers hold
 * (`batchEnd`), every batch in the frame. All arrays are allocated once.
 *
 * NO PAGE WAITS FOREVER. A frame that cannot draw the whole list — its batches past the most its
 * memory holds, a batch that cannot be encoded — stops at a page and leaves the rest pending
 * (`reset(stopped)`, `plan.reissue`). Until a frame draws its whole list again, the list orders
 * the pages by age first — the frames since each turned stale (`pool.sinceFrame`), the oldest
 * first —, then by view. The pages ahead of a pending page turned stale before it, or in its
 * frame: no page that turns stale later passes it, whatever its view, so they are fewer each
 * frame, never more. A frame draws at least one page per batch, so a page that stays read is
 * drawn within ⌈pool pages / batches a frame draws⌉ + 1 frames of being listed: 25 for the
 * largest pool (4 096 pages, `MAX_SHADOW_BATCHES` 171), when every batch holds one page. While
 * nothing waits, the list is the view order alone: pages of one view that turned stale in
 * different frames are not split apart.
 */
export function createShadowAdmission(poolPages: number) {
  const list = new Int32Array(poolPages),
    /** The light view of each listed page (`viewKeyOf`), read by the batch cut and the runs. */
    keys = new Int32Array(poolPages),
    /** One exact sort key per admitted page: its age, then its view, then the page. */
    order = new Float64Array(poolPages),
    /** A sort key's weight of one frame of age: a multiple of the pool's pages, past any view. */
    ageWeight = poolPages * VIEW_KEYS;
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
    run(pool: ShadowPool, table: ShadowTable, latest: number, frame: number) {
      count = 0;
      for (let page = 0; page < pool.pages; page++) {
        if (pool.owner[page] < 0 || !pool.dirty[page]) continue;
        if (pool.requested[page] < latest) pool.withdraw(table, page);
        else {
          const age = waiting ? Math.min(Math.max(0, frame - pool.sinceFrame[page]), MAX_AGE) : 0;
          order[count++] = viewKeyOf(pool, page) * poolPages + page - age * ageWeight;
        }
      }
      order.subarray(0, count).sort();
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
