/**
 * THE ID HALF OF THE SHADOW MAP ARRAY, a frame's (`frameSetup.ts`): the maps — directional first,
 * then local, then the unreferenced cache entries —, and the next-map data each map leaves under its
 * previous id. Where each map's table lies is the table packing's (`tableBlocks.ts`).
 */
import type { VsmIdAllocator, VsmNextMap } from './cacheManager.ts'

/** Next-map data stride on the GPU (`VsmNextMap`). */
export const VSM_NEXT_MAP_BYTES = 16

/** The id half of the shadow map array. */
export class VsmMapIds implements VsmIdAllocator {
  /** The maps given ids this frame: ids [0, mapCount). */
  mapCount = 0
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

  /** The maps a frame may hold: the set's map slots (`VsmLayout.mapSlots`). */
  capacity = 0

  /** Empties the allocator for a new frame of `capacity` map slots, keeping its storage. */
  reset(capacity: number) {
    this.capacity = capacity
    this.mapCount = 0
    this.localMaps = 0
    this.unseenMaps = 0
    this.nextMapCount = 0
    this.nextMapIdCount = 0
    return this
  }

  /** Whether `count` more maps fit the frame's slots. */
  fits(count: number) {
    return this.mapCount + count <= this.capacity
  }
  /** Allocates `count` slots of the shadow map array. */
  private allocateMapSlots(count: number) {
    const id = this.mapCount
    this.mapCount += count
    return id
  }
  allocateDirectional(count: number) {
    if (this.unseenMaps !== 0 || this.localMaps !== 0)
      throw new Error('VSM: directional maps are allocated first')
    return this.allocateMapSlots(count)
  }
  allocateLocal(count: number) {
    if (this.unseenMaps !== 0) throw new Error('VSM: local maps before unreferenced ones')
    this.localMaps += count
    return this.allocateMapSlots(count)
  }
  allocateUnreferenced(count: number) {
    this.unseenMaps += count
    return this.allocateMapSlots(count)
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
