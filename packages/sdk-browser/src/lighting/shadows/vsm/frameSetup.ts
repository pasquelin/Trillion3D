/**
 * Per-frame CPU setup of the virtual shadow maps: the directional and local light setups, then the
 * id allocation — directional first, then local, then the unreferenced cache entries
 * (`frameLights.ts`, `mapIds.ts`) — and the tables' packing (`tableBlocks.ts`), then the
 * uploads of the page marking (projection data per id, uniform counts) and of the page address
 * update (the next-map data, `frameUploads.ts`), into the step-1 resources.
 *
 * Per frame:
 *   vsmCastBoxes(cache, changes)                            // scene update, previous frame's ids
 *   const plan = planVirtualShadowFrame(state, lights, camera, viewport)
 *   ... GPU passes (page management, marking, allocation, render, projection) ...
 *   finishVirtualShadowFrame(state, plan) // marks rendered, extracts the frame data, swaps
 */
import type { SceneLight } from '../../../../../sdk-core/src/scene/light/contracts.ts'
import { VSM_UNIFORMS_BYTES } from './constants.ts'
import { writeVsmUniforms, type VsmFrameUniforms } from './uniforms.ts'
import type { VsmCacheManager, VsmLightCache } from './cacheManager.ts'
import type { VsmCameraInput, VsmClipmap, VsmViewport } from './clipmap.ts'
import type { VsmLocalLightSetup } from './localLight.ts'
import type { VsmMapIds } from './mapIds.ts'
import { dropRemovedLights, type VsmFrameState } from './frameState.ts'
import { allocateFrameLights } from './frameLights.ts'
import { uploadNextMaps, uploadProjectionData } from './frameUploads.ts'
import { vsmShadowed } from './seenLights.ts'

/** One scene light handed to the frame. */
export interface VsmFrameLight {
  light: SceneLight
  /** False when the light is culled this frame (`vsmLightSeen`): its cache entry lives on
   *  unreferenced. */
  visible?: boolean
  /** A sun: how far from the eye, in metres, its maps take every caster, 0 or absent for no limit
   *  (`sunFarShadowDistance`, `frame/vsmFarShadow.ts`). */
  farShadowDistance?: number
  /** The clipmap levels a sun's maps take at most (`vsmSunLevels`, read of a sun alone); absent,
   *  the defaults'. */
  sunLevels?: number
}

/** Where each light's maps landed this frame. */
export interface VsmLightAllocation {
  id: string
  kind: SceneLight['kind']
  /** First VSM id; the maps are [firstId, firstId + count). */
  firstId: number
  count: number
  entry: VsmLightCache
  clipmap?: VsmClipmap
  local?: VsmLocalLightSetup
}

export interface VsmFramePlan {
  frameStamp: number
  /** Maps with projection data this frame: ids [0, projectionCount). */
  projectionCount: number
  /** Page-table blocks the maps' tables take (`tableBlocks.ts`). */
  tableBlocks: number
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

/** Packs every map's table into the page table's blocks (`tableBlocks.ts`) in the order the ids
 *  were given — the suns' first, then the local lights', then the entries no light referenced —,
 *  each by its finest mip (a clipmap level's is 0), into its record's `tableOrigin`; returns the
 *  blocks taken. */
function packTables(state: VsmFrameState, lights: readonly VsmLightAllocation[]) {
  const blocks = state.tableBlocks.reset()
  const pack = (entry: VsmLightCache) => {
    for (const map of entry.mapCaches)
      map.projectionData.tableOrigin = blocks.take(map.projectionData.finestMip)
  }
  for (const light of lights) pack(light.entry)
  for (const entry of state.cache.entries.values())
    if (!entry.seenThisFrame && entry.mapId >= 0) pack(entry)
  return blocks.blocks
}

/** True when a cache entry got no id this frame: the page table is short. */
function anyUnallocated(cache: VsmCacheManager) {
  for (const entry of cache.entries.values()) if (entry.mapId < 0) return true
  return false
}

/** The frame's uniform counts. */
function frameUniforms(state: VsmFrameState, ids: VsmMapIds) {
  const uniforms: VsmFrameUniforms = {
    mapCount: ids.mapCount,
    frameStamp: state.frameStamp,
    pressureBias: state.cache.pressureBias,
  }
  return uniforms
}

/**
 * Builds this frame's virtual shadow maps on the CPU and uploads projection data, next data and
 * uniforms into `state.resources` (`current` frame buffers). `lights` is every light of the scene;
 * a light absent from it is removed. Tables past the page table's blocks ask `grow` for room for
 * that many blocks: grown, the same frame goes on in the larger tables (the tables are sized per
 * frame); otherwise the plan overflows.
 */
export function planVirtualShadowFrame(
  state: VsmFrameState,
  lights: readonly VsmFrameLight[],
  camera: VsmCameraInput,
  viewport: VsmViewport,
  grow?: (blocksAsked: number) => boolean,
): VsmFramePlan {
  const { cache, resources, device } = state
  let layout = resources.layout
  state.frameStamp++
  cache.beginFrame(state.frameStamp, camera.viewId)
  cache.poolPages = layout.poolPages
  dropRemovedLights(state, lights)
  const casting = castingScratch
  casting.length = 0
  for (const l of lights) if (vsmShadowed(l)) casting.push(l)
  const { ids, allocations } = allocateFrameLights(state, casting, camera, viewport)
  const uniforms = frameUniforms(state, ids)
  const blocks = packTables(state, allocations)
  if (blocks > layout.fullMapCapacity && grow?.(blocks)) layout = resources.layout
  const plan: VsmFramePlan = {
    frameStamp: state.frameStamp,
    projectionCount: ids.mapCount,
    tableBlocks: blocks,
    lights: allocations,
    uniforms,
    nextMapCount: ids.nextMapCount,
    overflow:
      blocks > layout.fullMapCapacity ||
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
      if (rendered) light.entry.markRendered(plan.frameStamp)
      else light.entry.invalidate()
  const hasData = !plan.overflow && plan.projectionCount > 0
  state.cache.keepFrameForNext(hasData ? { mapCount: plan.projectionCount } : null)
  // The buffers themselves swap in `keepVsmFrame` (pageManagementEncode.ts), called after.
}
