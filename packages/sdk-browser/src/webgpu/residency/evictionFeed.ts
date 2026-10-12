import type { GpuSelection } from '../../gpu/core/selection.ts'
import type { createGpuPageCache } from '../../gpu/page/pages.ts'
import type { EvictionOrder } from '../../gpu/page/eviction.ts'
import { pageAddress } from '../row/pageSlots.ts'
import { createPageCatalogue, type PageList } from '../../page/selection/catalogue.ts'
import { EVICT_IN_USE } from '../../gpu/dag/evict.ts'

type Cache = Pick<
  ReturnType<typeof createGpuPageCache>,
  'evictInOrder' | 'arrivals' | 'takeRefused'
>

/** Frames the cache's arrivals are remembered for: past the readback slots a cut is read back
 *  behind (`../../gpu/dag/layout.ts`, `DAG_READBACK_SLOTS`), with room. */
const ARRIVAL_FRAMES = 8

/**
 * Hands the GPU cut's eviction queue (`../../gpu/dag/evict.ts`) to the cache once per readback,
 * with what makes it exact when it is read frames later: the cache's arrivals when its cut ran —
 * noted here every frame, before the frame cuts —, so a page that arrived since is never its
 * victim, and its selection, so the order closes while that selection's cut is held
 * (`cutHeld`): the frames then draw an older cut, whose pages must stay. A load the pool refused
 * for lack of a place asks the GPU a new order (`askEvictions`) — a cut standing still makes none
 * of its own —, once the order in hand is old enough for the ages to have moved. Addresses are
 * read on a page's record as each victim is taken, never the catalogue.
 */
export function createEvictionFeed(packedPages: PageList, getCache: () => Cache | undefined) {
  let last: unknown,
    from: GpuSelection | undefined,
    /** The frame the order in hand was cut at; -1 for none. */
    madeAt = -1,
    ids = new Int32Array(0)
  const arrivals = new Float64Array(ARRIVAL_FRAMES).fill(-1)
  const { recordOf } = createPageCatalogue(packedPages)
  const order: EvictionOrder & { count: number; old: number; arrivals: number } = {
    count: 0,
    old: 0,
    arrivals: 0,
    keyAt: (at: number) => pageAddress(recordOf(ids[at])!),
    open: () => !!from && !from.cutHeld,
  }
  return (selection: GpuSelection, frame: number) => {
    const cache = getCache()
    if (!cache) return
    arrivals[frame % ARRIVAL_FRAMES] = cache.arrivals
    if (selection !== from) {
      from = selection
      last = undefined
      madeAt = -1
      cache.evictInOrder(undefined)
    }
    if (cache.takeRefused() && (madeAt < 0 || frame - madeAt >= EVICT_IN_USE))
      selection.askEvictions()
    const cut = selection.peek()
    // A residency change voids the cut until the next readback: the last order holds meanwhile.
    if (cut === last || !cut) return
    last = cut
    const queue = cut.result.evictPageIds,
      at = cut.uniforms.frame ?? -1,
      made = at >= 0 && frame - at < ARRIVAL_FRAMES ? arrivals[at % ARRIVAL_FRAMES] : -1
    madeAt = at
    if (!queue || made < 0) return cache.evictInOrder(undefined)
    // Copied: the readback slot's list is rewritten two readbacks later, the cache may read on.
    if (ids.length < queue.length) ids = new Int32Array(queue.length)
    ids.set(queue)
    order.count = queue.length
    order.old = Math.min(queue.length, cut.result.evictOld ?? 0)
    order.arrivals = made
    cache.evictInOrder(order)
  }
}
