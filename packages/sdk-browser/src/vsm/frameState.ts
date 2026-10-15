/**
 * WHAT A FRAME SET'S PLAN HOLDS FROM FRAME TO FRAME (`frameSetup.ts`): its cache, its upload
 * images and the id allocator.
 */
import { VSM_PROJECTION_RECORD_BYTES, VSM_UNIFORMS_BYTES } from './constants.ts'
import type { VsmResources } from './resources.ts'
import { VsmCacheManager } from './cacheManager.ts'
import { VSM_NEXT_MAP_BYTES, VsmMapIds } from './mapIds.ts'
import type { VsmFrameLight } from './frameSetup.ts'

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
  uniformsImage: ArrayBuffer
  /** The id allocator, emptied each frame (`VsmMapIds.reset`). */
  ids: VsmMapIds
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
        cacheEnabled: layout.staticSlice === 1,
      }),
    frameStamp: 0,
    projectionImage: new ArrayBuffer(layout.mapSlots * VSM_PROJECTION_RECORD_BYTES),
    nextMapsImage: new ArrayBuffer(layout.mapSlots * VSM_NEXT_MAP_BYTES),
    nextMapsHeld: [],
    nextMapsHeldCount: 0,
    uniformsImage: new ArrayBuffer(VSM_UNIFORMS_BYTES),
    ids: new VsmMapIds(),
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
