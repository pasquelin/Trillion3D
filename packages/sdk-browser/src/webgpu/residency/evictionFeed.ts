import type { PageRec } from '../../page/selection/selection.ts';
import type { GpuSelection } from '../../gpu/core/selection.ts';
import type { createGpuPageCache } from '../../gpu/page/pages.ts';
import { pageAddress } from '../row/pageSlots.ts';

type Cache = Pick<ReturnType<typeof createGpuPageCache>, 'slots' | 'evictInOrder'>;

/**
 * Hands the GPU cut's eviction queue (`../../gpu/dag/evict.ts`) to the cache, once per readback,
 * and the pool's slots to the cut, which bounds the queue by them. The queue names canonical pages;
 * the cache holds addresses, read on each page's record: as many as the pool has slots, never the
 * catalogue. Without a GPU cut the cache goes back to its least recent page (`budgetRanking` then
 * still chooses what the CPU cut loads, #836).
 */
export function createEvictionFeed(
  packedPages: readonly PageRec[],
  getCache: () => Cache | undefined,
) {
  let last: unknown;
  /** `null` on a CPU cut's image. */
  return (selection: GpuSelection | null) => {
    const cache = getCache();
    if (!cache) return;
    const cut = selection?.peek();
    selection?.setPoolSlots(cache.slots);
    if (cut === last) return;
    last = cut;
    const ids = cut?.result.evictPageIds;
    if (!ids) return cache.evictInOrder(undefined);
    // A new array per queue: the cache may still be reading the previous one in a burst.
    cache.evictInOrder(ids.map((id) => pageAddress(packedPages[id])));
  };
}
