import type { GpuPageContext } from './types.ts'
import { placesFor } from './loadPlace.ts'

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
        offset: page.offset,
        generation: page.generation,
        changed: true,
        pinned: eviction.pinnedCount,
      }))
    },
    /** Places a load can take now without a victim: the free streaming slots (`placement.ts`). */
    room: () => placesFor(context),
    /** Whether the page `key` lands in a root grain, never a streaming slot nor a victim's: a root
     *  page, the pool having a root region (`placement.ts`). */
    rooted: (key: string) => context.placement.rooted(key),
    /** The root grains a root page can take now (`placement.ts`). */
    rootRoom: () => context.placement.rootFree,
    /** Whether the page `key` is pinned. */
    isPinned: eviction.isPinned,
    /** Whether the pool holds the page `key`: it keeps it until the host names it a victim
     *  (`load.ts`). */
    holds: (key: string) => resident.has(key),
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
