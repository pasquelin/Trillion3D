import type { PageRec } from '../../page/selection/selection.ts';
import type { GpuSelection } from '../../gpu/core/selection.ts';
import type { createGpuPageCache } from '../../gpu/page/pages.ts';
import { pageAddress } from '../row/pageSlots.ts';

type Cache = Pick<ReturnType<typeof createGpuPageCache>, 'slots' | 'evictInOrder'>;

/**
 * Hands the GPU cut's eviction queue (`../../gpu/dag/evict.ts`) to the cache, once per readback,
 * and the pool's slots to the cut, which bounds the queue by them. The queue names canonical pages;
 * the cache holds addresses, read on a page's record as each victim is taken, never the catalogue. Without a GPU cut the cache goes back to its least recent page (`budgetRanking` then
 * still chooses what the CPU cut loads, #836).
 */
export function createEvictionFeed(
  packedPages: readonly PageRec[],
  getCache: () => Cache | undefined,
) {
  let last: unknown,
    ids = new Int32Array(0),
    count = 0;
  /** The queue as the cache reads it: an address resolved per victim taken, never all of them. */
  const order = {
    get count() {
      return count;
    },
    keyAt: (at: number) => pageAddress(packedPages[ids[at]]),
  };
  /** `null` on a CPU cut's image. */
  return (selection: GpuSelection | null) => {
    const cache = getCache();
    if (!cache) return;
    const cut = selection?.peek();
    selection?.setPoolSlots(cache.slots);
    // A residency change voids the cut in hand until the next readback: the last order holds, the
    // GPU-cut path never falls back to the least recent page, which may be one the cut reads.
    if (cut === last || (selection && !cut)) return;
    last = cut;
    const queue = cut?.result.evictPageIds;
    if (!queue) return cache.evictInOrder(undefined);
    // Copied: the readback slot's list is rewritten two readbacks later, the cache may read on.
    if (ids.length < queue.length) ids = new Int32Array(queue.length);
    ids.set(queue);
    count = queue.length;
    cache.evictInOrder(order);
  };
}
