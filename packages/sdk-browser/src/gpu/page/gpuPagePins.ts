import type { GpuPageContext } from './types.ts'
import { placesFor } from './load.ts'

export function createGpuPagePins(context: GpuPageContext) {
  const { resident, eviction, check, reader } = context
  const { emit } = reader
  return {
    /** Pins the resident page `key`, one hold of the eviction's heap. */
    pin(key: string) {
      check()
      const page = resident.get(key)
      if (!page) {
        emit?.('gpu-page-pin-refused', 'GPU pin refused', () => ({
          version: 1,
          key,
          reason: 'not-resident',
        }))
        throw new Error('PAGE_NOT_RESIDENT')
      }
      if (!eviction.pin(key)) return
      emit?.('gpu-page-pin', 'GPU page pinned', () => ({
        version: 1,
        key,
        slot: page.slot,
        generation: page.generation,
        changed: true,
        pinned: eviction.pinnedCount,
      }))
    },
    /** Places a load can take now: the free slots and quarters, then the pages the published
     *  order still gives — its old head alone for a page of a lower tier (`eviction.ts`). */
    room: (lower = false) => placesFor(context, lower),
    /** Whether the page `key` is pinned. */
    isPinned: eviction.isPinned,
    /** Whether the pool holds the page `key` and keeps it: pinned, in use by some view, or not
     *  given up by the order in hand (`eviction.ts`). */
    holds: (key: string) => resident.has(key) && !eviction.evictable(key),
    /** Unpins `key`; true when it was pinned. */
    unpin(key: string) {
      if (!eviction.unpin(key)) return false
      emit?.('gpu-page-unpin', 'GPU pin removed', () => ({
        version: 1,
        key,
        changed: true,
        pinned: eviction.pinnedCount,
      }))
      return true
    },
  }
}
