/**
 * THE PLAN'S UPLOADS (`frameSetup.ts`): the projection data the page marking reads, by id, and the
 * next-map data the page address update reads, by previous id — each where it changed alone.
 */
import { VSM_SINGLE_PAGE_MAP_SLOTS, VSM_PROJECTION_RECORD_BYTES } from './constants.ts'
import { writeVsmProjectionData } from './projectionData.ts'
import { writeChanged, writeChangedRecords } from '../gpu/core/writeChanged.ts'
import { wordViews } from '../gpu/core/wordViews.ts'
import { uniqueSortedInPlace } from '../../../math/src/scalar/integers.ts'
import { VSM_NEXT_MAP_BYTES, type VsmMapIds } from './mapIds.ts'
import type { VsmFrameState } from './frameState.ts'

/** The marking pass's input: every cache entry's projection data at its id, the single-page
 *  maps' records then the full maps', where they changed alone (`writeChanged`): a still view
 *  and still lights send nothing. */
export function uploadProjectionData(state: VsmFrameState, ids: VsmMapIds) {
  const { cache, resources, device } = state,
    image = state.projectionImage
  for (const entry of cache.entries.values()) {
    const maps = entry.mapCaches
    for (let index = 0; index < maps.length; index++)
      writeVsmProjectionData(image, entry.mapId + index, maps[index].projectionData)
  }
  const words = wordViews(image).u,
    record = VSM_PROJECTION_RECORD_BYTES / 4,
    full = VSM_SINGLE_PAGE_MAP_SLOTS * record
  writeChanged(device, resources.current.projectionData, words, 0, ids.singlePageMapCount * record)
  writeChanged(
    device,
    resources.current.projectionData,
    words,
    full,
    full + ids.fullMapCount * record,
  )
}

/** The ids whose next-map records a frame may change, increasing (`uploadNextMaps`). */
let touchedIds = new Int32Array(64)

/** The page address update: the next-map data by previous id. The image drops the last frame's
 *  records and takes this frame's: below the count, the words a whole write would send; those that
 *  changed go up. Only the records of the ids dropped or taken can change — the full maps' ids
 *  start past the single-page slots, so the table is wide and those few —: they alone are compared
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
