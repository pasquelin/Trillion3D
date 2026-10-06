import type { GpuSelection } from '../../gpu/core/selection.ts'
import type { createGpuPageCache } from '../../gpu/page/pages.ts'
import { pageAddress } from '../row/pageSlots.ts'
import { createPageCatalogue, type PageList } from '../pages/prepare/catalogue.ts'

type Cache = Pick<ReturnType<typeof createGpuPageCache>, 'evictInOrder'>

/**
 * Hands the GPU cut's eviction queue (`../../gpu/dag/evict.ts`) to the cache once per readback.
 * Addresses are read on a page's record as each victim is taken, never
 * the catalogue. A CPU cut's image (`null`) evicts the least recent page (`requestAdmission.ts`).
 */
export function createEvictionFeed(packedPages: PageList, getCache: () => Cache | undefined) {
  let last: unknown,
    ids = new Int32Array(0)
  const { recordOf } = createPageCatalogue(packedPages)
  const order = { count: 0, keyAt: (at: number) => pageAddress(recordOf(ids[at])!) }
  return (selection: GpuSelection | null) => {
    const cache = getCache()
    if (!cache) return
    const cut = selection?.peek()
    // A residency change voids the cut until the next readback: the last order holds meanwhile.
    if (cut === last || (selection && !cut)) return
    last = cut
    const queue = cut?.result.evictPageIds
    if (!queue) return cache.evictInOrder(undefined)
    // Copied: the readback slot's list is rewritten two readbacks later, the cache may read on.
    if (ids.length < queue.length) ids = new Int32Array(queue.length)
    ids.set(queue)
    order.count = queue.length
    cache.evictInOrder(order)
  }
}
