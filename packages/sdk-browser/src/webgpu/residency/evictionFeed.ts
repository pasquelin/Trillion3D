import type { PageRec } from '../../page/selection/selection.ts';
import type { GpuSelection } from '../../gpu/core/selection.ts';
import type { createGpuPageCache } from '../../gpu/page/pages.ts';
import { pageAddress } from '../row/pageSlots.ts';

type Cache = Pick<ReturnType<typeof createGpuPageCache>, 'slots' | 'evictInOrder'>;

/**
 * Hands the GPU cut's eviction queue (`../../gpu/dag/evict.ts`) to the cache once per readback, and
 * the pool's slots to the cut. Addresses are read on a page's record as each victim is taken, never
 * the catalogue. A CPU cut's image (`null`) evicts the least recent page (`budgetRanking` stays, #836).
 */
export function createEvictionFeed(
  packedPages: readonly PageRec[],
  getCache: () => Cache | undefined,
) {
  let last: unknown,
    ids = new Int32Array(0);
  const order = { count: 0, keyAt: (at: number) => pageAddress(packedPages[ids[at]]) };
  return (selection: GpuSelection | null) => {
    const cache = getCache();
    if (!cache) return;
    const cut = selection?.peek();
    selection?.setPoolSlots(cache.slots);
    // A residency change voids the cut until the next readback: the last order holds meanwhile.
    if (cut === last || (selection && !cut)) return;
    last = cut;
    const queue = cut?.result.evictPageIds;
    if (!queue) return cache.evictInOrder(undefined);
    // Copied: the readback slot's list is rewritten two readbacks later, the cache may read on.
    if (ids.length < queue.length) ids = new Int32Array(queue.length);
    ids.set(queue);
    order.count = queue.length;
    cache.evictInOrder(order);
  };
}
