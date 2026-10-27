/**
 * THE PLAN'S UPLOADS (`frameSetup.ts`): the projection data the page marking reads, by id, and the
 * next-map data the page address update reads, by previous id — each where it changed alone.
 */
import { VSM_PROJECTION_RECORD_BYTES } from './constants.ts'
import {
  VSM_HISTORY_BLEND_WORD,
  VSM_HISTORY_SUN_WORD,
  VSM_MAP_PREFILTERED_DISTANT,
  vsmHistoryLayout,
} from './prefilteredConstants.ts'
import { writeVsmProjectionData } from './projection/projectionData.ts'
import { writeChanged, writeChangedRecords } from '../../../gpu/core/writeChanged.ts'
import { wordViews } from '../../../gpu/core/wordViews.ts'
import { f32Bits } from '../../../../../math/src/float/bits.ts'
import { uniqueSortedInPlace } from '../../../../../math/src/scalar/integers.ts'
import { VSM_NEXT_MAP_BYTES, type VsmMapIds } from './mapIds.ts'
import type { VsmFrameState } from './frameState.ts'

/** The marking pass's input: every cache entry's projection data at its id, where it changed alone
 *  (`writeChanged`): a still view and still lights send nothing. */
export function uploadProjectionData(state: VsmFrameState, ids: VsmMapIds) {
  const { cache, resources, device } = state,
    image = state.projectionImage
  for (const entry of cache.entries.values()) {
    const maps = entry.mapCaches
    for (let index = 0; index < maps.length; index++) {
      const data = maps[index].projectionData
      data.viewSlot = cache.viewSlotOf(entry.view)
      writeVsmProjectionData(image, entry.mapId + index, data)
    }
  }
  const words = wordViews(image).u
  writeChanged(
    device,
    resources.current.projectionData,
    words,
    0,
    (ids.mapCount * VSM_PROJECTION_RECORD_BYTES) / 4,
  )
}

/** The ids whose next-map records a frame may change, increasing (`uploadNextMaps`). */
let touchedIds = new Int32Array(64)

/** The page address update: the next-map data by previous id. The image drops the last frame's
 *  records and takes this frame's: below the count, the words a whole write would send; those that
 *  changed go up. Only the records of the ids dropped or taken can change: they alone are compared
 *  (`writeChangedRecords`). */
export function uploadNextMaps(state: VsmFrameState, ids: VsmMapIds) {
  const { u, i } = wordViews(state.nextMapsImage),
    held = state.nextMapsHeld,
    dropped = state.nextMapsHeldCount,
    taken = ids.nextMapIdCount
  if (touchedIds.length < dropped + taken) touchedIds = new Int32Array(2 * (dropped + taken))
  for (let j = 0; j < dropped; j++) {
    u.fill(0, held[j] * 4, held[j] * 4 + 4)
    touchedIds[j] = held[j]
  }
  for (let j = 0; j < taken; j++) {
    const id = ids.nextMapIds[j],
      d = ids.nextMaps[id]
    u[id * 4] = d.flags >>> 0
    i[id * 4 + 1] = d.nextMapId
    i[id * 4 + 2] = d.pageShift[0]
    i[id * 4 + 3] = d.pageShift[1]
    held[j] = id
    touchedIds[dropped + j] = id
  }
  state.nextMapsHeldCount = taken
  const touched = touchedIds.subarray(0, dropped + taken)
  const distinct = uniqueSortedInPlace(touched)
  writeChangedRecords(
    state.device,
    state.resources.nextMaps,
    u,
    touched,
    distinct,
    VSM_NEXT_MAP_BYTES / 4,
  )
}

/**
 * The prefiltered distant shadow's history, the words the frame's plan owns, where they changed alone:
 * whether the frame has a map that holds the feature (`filterable.active`), the share of the previous
 * frame the filter keeps (the setting's, 0 while the history holds no frame or the frame no such map)
 * and each of the suns' current map ids' previous id + 1, from the next-map data the ids hold — 0 for a
 * map with no previous one, as the reference's inverse of its next-map data. The suns' maps are
 * addressed from the first of them (`VsmMapIds.sunBase`), this frame's in the ids and the previous
 * frame's (`VsmCacheManager.prevFrame`) in the records, whose first the GPU is told. The regions the
 * frame end copies (the records, the page table, the receiver cover) are the GPU's.
 */
export function uploadFilterableHistory(state: VsmFrameState, ids: VsmMapIds) {
  const { device, resources, cache } = state,
    { filterable, layout } = resources
  if (!filterable) return
  filterable.active = false
  for (const entry of cache.entries.values())
    if (entry.mapId >= 0)
      for (const map of entry.mapCaches)
        filterable.active ||= (map.projectionData.flags & VSM_MAP_PREFILTERED_DISTANT) !== 0
  const { idsWord, idWords } = vsmHistoryLayout(layout)
  const image = (state.filterableHistory =
    state.filterableHistory?.length === idsWord + idWords
      ? state.filterableHistory
      : new Uint32Array(idsWord + idWords))
  const valid = filterable.active && filterable.historyValid
  image.fill(0, VSM_HISTORY_BLEND_WORD)
  if (valid) {
    image[VSM_HISTORY_BLEND_WORD] = f32Bits(
      state.maps.shadows.shadowPrefilteredDistantHistoryBlendFactor,
    )
    image[VSM_HISTORY_SUN_WORD] = ids.sunBase
    const prevBase = cache.prevFrame?.sunBase ?? 0
    for (let j = 0; j < ids.nextMapIdCount; j++) {
      const prev = ids.nextMapIds[j] - prevBase,
        next = ids.nextMaps[ids.nextMapIds[j]].nextMapId - ids.sunBase
      if (prev >= 0 && prev < idWords && next >= 0 && next < idWords)
        image[idsWord + next] = prev + 1
    }
  }
  writeChanged(device, filterable.history, image, VSM_HISTORY_BLEND_WORD, idsWord + idWords)
}
