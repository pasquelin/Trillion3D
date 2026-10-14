/**
 * Per-frame CPU setup of the virtual shadow maps: the distant-light scheduling, the directional
 * and local light setups, then the id allocation — directional first, then local, then the
 * unreferenced cache entries (`frameLights.ts`, `mapIds.ts`) — and its bookkeeping, then the
 * uploads of the page marking (projection data per id, uniform counts) and of the page address
 * update (the next-map data, `frameUploads.ts`), into the step-1 resources.
 *
 * Per frame:
 *   vsmCastBoxes(cache, changes)                            // scene update, previous frame's ids
 *   const plan = planVirtualShadowFrame(state, lights, camera, viewport)
 *   ... GPU passes (page management, marking, allocation, render, projection) ...
 *   finishVirtualShadowFrame(state, plan) // marks rendered, extracts the frame data, swaps
 */
import type { SceneLight } from '../../../sdk-core/src/scene/light/contracts.ts'
import { VSM_SINGLE_PAGE_MAP_SLOTS, VSM_UNIFORMS_BYTES } from './constants.ts'
import { writeVsmUniforms, type VsmFrameUniforms } from './uniforms.ts'
import type { VsmCacheManager, VsmLightCache } from './cacheManager.ts'
import type { VsmCameraInput, VsmClipmap, VsmViewport } from './clipmap.ts'
import type { VsmLocalLightSetup } from './localLight.ts'
import type { VsmMapIds } from './mapIds.ts'
import { trackLightShapes, type VsmFrameState } from './frameState.ts'
import { allocateFrameLights } from './frameLights.ts'
import { uploadNextMaps, uploadProjectionData } from './frameUploads.ts'
import { vsmShadowed } from './seenLights.ts'

/** One scene light handed to the frame. */
export interface VsmFrameLight {
  light: SceneLight
  /** False when the light is culled this frame (`vsmLightSeen`): its cache entry lives on
   *  unreferenced. */
  visible?: boolean
}

/** Where each light's maps landed this frame. */
export interface VsmLightAllocation {
  id: string
  kind: SceneLight['kind']
  /** First VSM id; the maps are [firstId, firstId + count). */
  firstId: number
  count: number
  singlePage: boolean
  /** Render its pages this frame (always for a clipmap; not fully cached for a local light). */
  shouldRender: boolean
  entry: VsmLightCache
  clipmap?: VsmClipmap
  local?: VsmLocalLightSetup
}

export interface VsmFramePlan {
  frameStamp: number
  /** Full + single-page maps with projection data this frame. */
  projectionCount: number
  fullMapCount: number
  singlePageMapCount: number
  mapSlotCount: number
  /** Referenced lights, directional first then local, in allocation order. */
  lights: VsmLightAllocation[]
  uniforms: VsmFrameUniforms
  /** The next-map data count: entries uploaded to `resources.nextMaps`. */
  nextMapCount: number
  /** Map ids exceed the resources' capacity: nothing was uploaded; recreate the resources
   *  larger. */
  overflow: boolean
}

// The frame's light lists of `planVirtualShadowFrame`, emptied at each call.
const castingScratch: VsmFrameLight[] = []

/** True when a cache entry got no id this frame: the page table is short. */
function anyUnallocated(cache: VsmCacheManager) {
  for (const entry of cache.entries.values()) if (entry.mapId < 0) return true
  return false
}

/** The frame's uniform counts. */
function frameUniforms(state: VsmFrameState, ids: VsmMapIds) {
  const uniforms: VsmFrameUniforms = {
    fullMapCount: ids.fullMapCount,
    singlePageMapCount: ids.singlePageMapCount,
    frameStamp: state.frameStamp,
    pressureBias: state.cache.pressureBias,
  }
  return uniforms
}

/**
 * Builds this frame's virtual shadow maps on the CPU and uploads projection data, next data and
 * uniforms into `state.resources` (`current` frame buffers). `lights` is every light of the scene;
 * a light absent from it is removed. Ids past the tables ask
 * `grow` for room for that many full maps: grown, the same frame goes on in the larger tables
 * (the tables are sized per frame); otherwise the plan overflows.
 */
export function planVirtualShadowFrame(
  state: VsmFrameState,
  lights: readonly VsmFrameLight[],
  camera: VsmCameraInput,
  viewport: VsmViewport,
  grow?: (fullMapsAsked: number) => boolean,
): VsmFramePlan {
  const { cache, resources, device } = state
  let layout = resources.layout
  state.frameStamp++
  cache.frameStamp = state.frameStamp
  cache.poolPages = layout.poolPages
  trackLightShapes(state, lights)
  const mobilityOf = (id: string) => state.lightShapes.get(id)?.mobilityFactor ?? 0
  // The distant light refresh schedule.
  cache.scheduleFarLights()
  const casting = castingScratch
  casting.length = 0
  for (const l of lights) if (vsmShadowed(l)) casting.push(l)
  const { ids, allocations } = allocateFrameLights(state, casting, camera, viewport, mobilityOf)
  const uniforms = frameUniforms(state, ids)
  const fullMaps = Math.max(ids.fullMapCount, ids.nextMapCount - VSM_SINGLE_PAGE_MAP_SLOTS)
  if (fullMaps > layout.fullMapCapacity && grow?.(fullMaps)) layout = resources.layout
  const plan: VsmFramePlan = {
    frameStamp: state.frameStamp,
    projectionCount: ids.mapCount,
    fullMapCount: ids.fullMapCount,
    singlePageMapCount: ids.singlePageMapCount,
    mapSlotCount: ids.mapSlotCount,
    lights: allocations,
    uniforms,
    nextMapCount: ids.nextMapCount,
    overflow:
      ids.fullMapCount > layout.fullMapCapacity ||
      ids.singlePageMapCount > VSM_SINGLE_PAGE_MAP_SLOTS ||
      anyUnallocated(cache) ||
      ids.nextMapCount > layout.mapSlots,
  }
  if (plan.overflow) return plan
  uploadProjectionData(state, ids)
  uploadNextMaps(state, ids)
  writeVsmUniforms(state.uniformsImage, layout, uniforms)
  device.queue.writeBuffer(
    resources.current.uniforms,
    0,
    state.uniformsImage,
    0,
    VSM_UNIFORMS_BYTES,
  )
  return plan
}

/**
 * End of frame, after the GPU work is encoded: every light whose pages were rendered is marked
 * rendered (clipmaps and local lights) — `rendered` false when the raster was skipped —, then the
 * frame data is extracted: the frame's buffers become `resources.prev`.
 */
export function finishVirtualShadowFrame(
  state: VsmFrameState,
  plan: VsmFramePlan,
  rendered = true,
) {
  // A frame whose raster was skipped drew none of the pages it allocated: none may be kept as
  // cached, so every light that should have rendered starts uncached next frame.
  if (!plan.overflow)
    for (const light of plan.lights)
      if (!light.shouldRender) continue
      else if (rendered) light.entry.markRendered(plan.frameStamp)
      else light.entry.invalidate()
  const hasData = !plan.overflow && plan.projectionCount > 0
  state.cache.keepFrameForNext(
    hasData
      ? {
          mapSlotCount: plan.mapSlotCount,
          fullMapCount: plan.fullMapCount,
          singlePageMapCount: plan.singlePageMapCount,
        }
      : null,
  )
  // The buffers themselves swap in `keepVsmFrame` (pageManagementEncode.ts), called after.
}
