/**
 * THE ID HALF OF THE SHADOW MAP ARRAY, a frame's (`frameSetup.ts`): the single-page slots, then the
 * full maps — directional first, then local, then the unreferenced cache entries —, and the
 * next-map data each map leaves under its previous id.
 */
import { VSM_SINGLE_PAGE_MAP_SLOTS } from './constants.ts'
import type { VsmIdAllocator, VsmNextMap } from './cacheManager.ts'

/** Next-map data stride on the GPU (`VsmNextMap`). */
export const VSM_NEXT_MAP_BYTES = 16

/** The id half of the shadow map array. */
export class VsmMapIds implements VsmIdAllocator {
  /** Single-page slots are always reserved (see `VSM_SINGLE_PAGE_MAP_SLOTS`): full ids start at 8192. */
  mapSlotCount = VSM_SINGLE_PAGE_MAP_SLOTS
  singlePageMapCount = 0
  localMaps = 0
  unseenMaps = 0
  /** The next-map data count: one past the largest previous id given next data
   *  this frame; the ids below it given none read zero (flags 0 = no caching). */
  nextMapCount = 0
  /** The previous ids given next data this frame: the first `nextMapIdCount`, in call order. */
  readonly nextMapIds: number[] = []
  nextMapIdCount = 0
  /** Each previous id's record, kept across frames (`reset`), this frame's those listed. */
  readonly nextMaps: VsmNextMap[] = []

  /** Empties the allocator for a new frame, keeping its storage. */
  reset() {
    this.mapSlotCount = VSM_SINGLE_PAGE_MAP_SLOTS
    this.singlePageMapCount = 0
    this.localMaps = 0
    this.unseenMaps = 0
    this.nextMapCount = 0
    this.nextMapIdCount = 0
    return this
  }

  get fullMapCount() {
    return Math.max(this.mapSlotCount - VSM_SINGLE_PAGE_MAP_SLOTS, 0)
  }
  get mapCount() {
    return this.fullMapCount + this.singlePageMapCount
  }
  /** Allocates `count` slots of the shadow map array. */
  private allocateMapSlots(singlePage: boolean, count: number) {
    if (singlePage) {
      if (this.singlePageMapCount + count > VSM_SINGLE_PAGE_MAP_SLOTS) return -1
      const id = this.singlePageMapCount
      this.singlePageMapCount += count
      return id
    }
    const id = this.mapSlotCount
    this.mapSlotCount += count
    return id
  }
  allocateDirectional(count: number) {
    if (this.unseenMaps !== 0 || this.localMaps !== 0)
      throw new Error('VSM: directional maps are allocated first')
    return this.allocateMapSlots(false, count)
  }
  allocateLocal(singlePage: boolean, count: number) {
    if (this.unseenMaps !== 0) throw new Error('VSM: local maps before unreferenced ones')
    this.localMaps += count
    return this.allocateMapSlots(singlePage, count)
  }
  allocateUnreferenced(singlePage: boolean, count: number) {
    this.unseenMaps += count
    return this.allocateMapSlots(singlePage, count)
  }
  /** Records a map's next-frame data under its previous id. */
  writeNextMap(prevId: number, data: VsmNextMap) {
    const slot = (this.nextMaps[prevId] ??= {
      flags: 0,
      nextMapId: 0,
      pageShift: [0, 0],
    })
    slot.flags = data.flags
    slot.nextMapId = data.nextMapId
    slot.pageShift[0] = data.pageShift[0]
    slot.pageShift[1] = data.pageShift[1]
    this.nextMapIds[this.nextMapIdCount++] = prevId
    if (prevId >= this.nextMapCount) this.nextMapCount = prevId + 1
  }
}
