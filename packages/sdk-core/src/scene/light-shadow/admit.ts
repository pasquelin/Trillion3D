import type { ShadowPool } from './pool.ts';
import type { ShadowTable } from './table.ts';
import { ringOf } from './virtual.ts';

/** The light view a page is drawn in — its light, then its sun level or lamp face and mip: the
 *  pages of one view share one caster selection. */
const viewKeyOf = (pool: ShadowPool, page: number) => pool.slice[page] * 4096 + pool.view[page];

/** Host bytes the admission of a `pages`-page pool allocates: its list, view keys, sort keys and
 *  wait counts. */
export const shadowAdmissionHostBytes = (pages: number) => pages * (4 + 4 + 8 + 2);

/** The most frames a page's wait counts: past any bound a frame of one-page batches reaches. */
const MAX_WAIT = 4095;
/** A sort key's weight of one frame waited: a multiple of the pool's pages, so the page stays the
 *  key's remainder, and 2^28 of them, past any view key (`slice · 4096 + view`, 64 lights). The
 *  heaviest key, `MAX_WAIT` frames of the largest pool, stays under 2^53: exact. */
const WAIT_VIEWS = 2 ** 28;

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
 * memory holds, a batch that cannot be encoded — stops at a page (`reset(stopped)`), and each page
 * it left undrawn counts one more frame waited. The list orders the pages by frames waited first,
 * the longest first, then by view: a page listed after it cannot pass it, whatever its view, and
 * the pages ahead of it are only those that waited as long or longer — fewer each frame, never
 * more. A frame draws at least one page per batch, so a page that stays read is drawn within
 * ⌈pool pages / batches a frame draws⌉ + 1 frames of being listed: 25 for the largest pool
 * (4 096 pages, `MAX_SHADOW_BATCHES` 171), when every batch holds one page. While nothing waits,
 * the list is the view order alone.
 */
export function createShadowAdmission(poolPages: number) {
  const list = new Int32Array(poolPages),
    /** The light view of each listed page (`viewKeyOf`), read by the batch cut and the runs. */
    keys = new Int32Array(poolPages),
    /** One exact sort key per admitted page: its frames waited, then its view, then the page. */
    order = new Float64Array(poolPages),
    /** Per page: the frames it was listed and left undrawn since it was last drawn or unlisted. */
    waited = new Uint16Array(poolPages),
    waitWeight = poolPages * WAIT_VIEWS;
  let count = 0;
  return {
    list,
    keys,
    hostBytes: list.byteLength + keys.byteLength + order.byteLength + waited.byteLength,
    get count() {
      return count;
    },
    /** Lists every stale page the report of frame `latest` named; returns how many. */
    run(pool: ShadowPool, table: ShadowTable, latest: number) {
      count = 0;
      for (let page = 0; page < pool.pages; page++) {
        if (pool.owner[page] >= 0 && pool.dirty[page] && pool.requested[page] >= latest)
          order[count++] = viewKeyOf(pool, page) * poolPages + page - waited[page] * waitWeight;
        else {
          waited[page] = 0;
          if (pool.owner[page] >= 0 && pool.dirty[page]) pool.withdraw(table, page);
        }
      }
      order.subarray(0, count).sort();
      for (let i = 0; i < count; i++) {
        // A sun level may be negative: the page is the key's remainder, taken positive.
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
    /** Closes the list. The frame drew it up to `stopped`: the pages past it waited one frame. */
    reset(stopped = count) {
      for (let i = 0; i < count; i++)
        waited[list[i]] = i < stopped ? 0 : Math.min(waited[list[i]] + 1, MAX_WAIT);
      count = 0;
    },
  };
}
