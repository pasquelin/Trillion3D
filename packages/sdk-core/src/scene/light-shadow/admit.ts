import type { ShadowPool } from './pool.ts';
import type { ShadowTable } from './table.ts';
import { ringOf } from './virtual.ts';

/** The light view a page is drawn in — its light, then its sun level or lamp face and mip: the
 *  pages of one view share one caster selection. */
const viewKeyOf = (pool: ShadowPool, page: number) => pool.slice[page] * 4096 + pool.view[page];

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
 * memory holds, a batch that cannot be encoded — stops at a page (`reset(stopped)`), and the next
 * list starts at that page's place in the order and wraps around: the pages it left pending come
 * first, and views re-marked every frame ahead of them in the order cannot beat them every frame.
 * A frame draws at least one page per batch, so while the pool's pages keep their views a page
 * that stays read is drawn within ⌈pool pages / batches a frame draws⌉ frames of being listed:
 * ⌈4096 / 171⌉ = 24 for the largest pool (`MAX_SHADOW_BATCHES`), when every batch holds one page.
 */
export function createShadowAdmission(poolPages: number) {
  const list = new Int32Array(poolPages),
    /** The light view of each listed page (`viewKeyOf`), read by the batch cut and the runs. */
    keys = new Int32Array(poolPages),
    /** One exact sort key per admitted page: its view, then the page itself. */
    order = new Float64Array(poolPages);
  let count = 0,
    /** The sort key the next list starts at: the first page the last frame left undrawn. */
    resume = -Infinity;
  return {
    list,
    keys,
    get count() {
      return count;
    },
    /** Lists every stale page the report of frame `latest` named; returns how many. */
    run(pool: ShadowPool, table: ShadowTable, latest: number) {
      count = 0;
      for (let page = 0; page < pool.pages; page++) {
        if (pool.owner[page] < 0 || !pool.dirty[page]) continue;
        if (pool.requested[page] < latest) pool.withdraw(table, page);
        else order[count++] = viewKeyOf(pool, page) * poolPages + page;
      }
      order.subarray(0, count).sort();
      let start = 0;
      while (start < count && order[start] < resume) start++;
      if (start === count) start = 0;
      for (let i = 0, at = start; i < count; i++, at = at + 1 === count ? 0 : at + 1) {
        // A sun level may be negative: the page is the key's remainder, taken positive.
        list[i] = ringOf(order[at], poolPages);
        keys[i] = (order[at] - list[i]) / poolPages;
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
    /** Closes the list. The frame drew it up to `stopped`: the next list starts at that page. */
    reset(stopped = count) {
      resume = stopped < count ? keys[stopped] * poolPages + list[stopped] : -Infinity;
      count = 0;
    },
  };
}
