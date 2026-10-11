import type { GpuPageContext } from './types.ts'

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
    /**
     * Moves a resident page to the far end of the eviction order, without a load: a page a
     * lower tier still wants is then the last unpinned page a new arrival takes the slot of.
     */
    touch(key: string, lower = false) {
      if (!resident.has(key)) return false
      eviction.touched(key, lower)
      return true
    },
    /** Places a load can take without evicting a pinned page: the free slots and quarters, and
     *  the unpinned pages' (`places.ts`). */
    unpinnedSlots() {
      return context.placement.free + resident.size - eviction.pinnedCount
    },
    /** Whether the page `key` is pinned. */
    isPinned: eviction.isPinned,
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
