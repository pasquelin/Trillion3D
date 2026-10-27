/**
 * WHAT A FRAME SET'S PLAN HOLDS FROM FRAME TO FRAME (`frameSetup.ts`): its cache, its upload
 * images and the id allocator.
 */
import { VSM_PROJECTION_RECORD_BYTES, VSM_UNIFORMS_BYTES } from './constants.ts'
import type { VsmResources } from './resources.ts'
import { VsmCacheManager } from './cacheManager.ts'
import { VSM_NEXT_MAP_BYTES, VsmMapIds } from './mapIds.ts'
import { VsmTableBlocks } from './tableBlocks.ts'
import type { VsmFrameLight } from './frameSetup.ts'
import { VSM_DEFAULT_MAPS, type VsmMapSettings } from './mapSettings.ts'

export interface VsmFrameState {
  device: GPUDevice
  resources: VsmResources
  cache: VsmCacheManager
  /** The scene frame number: bumped by every plan. */
  frameStamp: number
  /** CPU images of the uploads. */
  projectionImage: ArrayBuffer
  /** Holds the records of the ids `nextMapsHeld` lists (the last frame's), zero elsewhere. */
  nextMapsImage: ArrayBuffer
  nextMapsHeld: number[]
  nextMapsHeldCount: number
  /** The words of the prefiltered distant shadow's history the plan writes, its blend then the previous
   *  id + 1 of each map id of the suns (`uploadFilterableHistory`), made at its first frame. */
  filterableHistory?: Uint32Array<ArrayBuffer>
  uniformsImage: ArrayBuffer
  /** The id allocator, emptied each frame (`VsmMapIds.reset`). */
  ids: VsmMapIds
  /** The tables' packing, emptied each frame (`VsmTableBlocks.reset`). */
  tableBlocks: VsmTableBlocks
  /** The view's shadow settings the frame's maps are set up from, and the scene frame they count
   *  mobility in: rewritten by each plan (`planVsmFrame`), the defaults until then. */
  maps: VsmMapSettings
}

export function createVsmFrameState(
  device: GPUDevice,
  resources: VsmResources,
  cache?: VsmCacheManager,
): VsmFrameState {
  const layout = resources.layout
  return {
    device,
    resources,
    cache:
      cache ??
      new VsmCacheManager({
        poolPages: layout.poolPages,
        cacheEnabled: layout.cacheEnabled,
      }),
    frameStamp: 0,
    projectionImage: new ArrayBuffer(layout.mapSlots * VSM_PROJECTION_RECORD_BYTES),
    nextMapsImage: new ArrayBuffer(layout.mapSlots * VSM_NEXT_MAP_BYTES),
    nextMapsHeld: [],
    nextMapsHeldCount: 0,
    uniformsImage: new ArrayBuffer(VSM_UNIFORMS_BYTES),
    ids: new VsmMapIds(),
    tableBlocks: new VsmTableBlocks(),
    maps: VSM_DEFAULT_MAPS,
  }
}

/** The frame's light ids (`dropRemovedLights`), emptied at each call. */
const present = new Set<string>()

/** Removed lights: the cache drops the entries of the lights `lights` no longer holds. A light that
 *  changed invalidates its own entry, by its cache key (`VsmLightCache.updateLocal`,
 *  `updateClipmap`). */
export function dropRemovedLights(state: VsmFrameState, lights: readonly VsmFrameLight[]) {
  present.clear()
  for (const { light } of lights) present.add(light.id)
  state.cache.dropRemovedLights((id) => !present.has(id))
}
