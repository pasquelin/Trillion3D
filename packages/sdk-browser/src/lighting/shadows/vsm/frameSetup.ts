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
import { DEG2RAD } from '../../../../../math/src/constants.ts'
import type { SceneLight } from '../../../../../sdk-core/src/scene/light/contracts.ts'
import type { SunCascades } from '../../../../../sdk-core/src/contracts/sunCascades.ts'
import { VSM_RECORD_MAP_ID_BITS, VSM_UNIFORMS_BYTES } from './constants.ts'
import { writeVsmUniforms, type VsmFrameUniforms } from './uniforms.ts'
import { focalScale } from '../../../../../math/src/projection/camera.ts'
import type { VsmCacheManager } from './cacheManager.ts'
import type { VsmLightCache } from './lightCache.ts'
import type { VsmCameraInput, VsmClipmap, VsmViewport } from './clipmap.ts'
import type { VsmLocalLightSetup } from './localLight.ts'
import type { VsmMapIds } from './mapIds.ts'
import { dropRemovedLights, type VsmFrameState } from './frameState.ts'
import { scheduleDistantUpdates } from './distantLights.ts'
import { allocateFrameLights } from './frameLights.ts'
import { uploadNextMaps, uploadProjectionData } from './frameUploads.ts'
import { vsmShadowed } from './seenLights.ts'
import { recordOcclusionView } from './occlusion/occlusionView.ts'

/** One scene light handed to the frame. */
export interface VsmFrameLight {
  light: SceneLight
  /** False when the light is culled this frame (`vsmLightSeen`): its cache entry lives on
   *  unreferenced. */
  visible?: boolean
  /** A sun: how far from the eye, in metres, its maps take every caster, 0 or absent for no limit
   *  (`sunCascadesOf`, `frame/vsmFarShadow.ts`): the edge of its cascades. */
  farShadowEdge?: number
  /** A sun's cascades this frame, the distance-field cascade's planes among them (`sunCascades`);
   *  absent for a light that is none. */
  cascades?: SunCascades
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
  /** The sun's first-person clipmap (\`shadowFirstPersonClipmap\`): a map set of its own for the objects
   *  that stand for a first-person one, never a record of its own — the sun's trace reads it beside its own. */
  firstPerson: boolean
}

export interface VsmFramePlan {
  frameStamp: number
  /** Maps with projection data this frame: ids [0, projectionCount). */
  projectionCount: number
  /** Page-table blocks the maps' tables take (`tableBlocks.ts`). */
  tableBlocks: number
  /** Referenced lights, directional first then local, in allocation order, the suns' first-person
   *  clipmaps among the directional. */
  lights: VsmLightAllocation[]
  /** The lights the projection gives a record to, in record order: \`lights\` but the first-person
   *  clipmaps, each of which is read through its sun's. */
  projected: VsmLightAllocation[]
  /** The first map of each sun's first-person clipmap, by the sun's id (\`firstPerson\`). */
  firstPersonOf: ReadonlyMap<string, number>
  uniforms: VsmFrameUniforms
  /** The next-map data count: entries uploaded to `resources.nextMaps`. */
  nextMapCount: number
  /** The map slots the frame asked: the maps given ids and those refused for want of slots. */
  mapsAsked: number
  /** Map ids exceed the resources' capacity: nothing was uploaded; recreate the resources
   *  larger. */
  overflow: boolean
}

// The frame's light lists of `planVirtualShadowFrame`, emptied at each call.
const castingScratch: VsmFrameLight[] = []
// The plan's channel order and its suns' first-person clipmaps, rebuilt in place by each call.
const projectedScratch: VsmLightAllocation[] = []
const firstPersonScratch = new Map<string, number>()

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

/** Each map's record of the view the occlusion pyramid last held it by: a map drawn this frame with
 *  the culling on (`occlusion`) hands it on and takes this frame's as its own
 *  (`recordOcclusionView`); every other record names none. */
function recordOcclusionViews(
  cache: VsmCacheManager,
  lights: readonly VsmLightAllocation[],
  occlusion: boolean,
) {
  for (const entry of cache.entries.values())
    for (const map of entry.mapCaches) map.projectionData.prevMapId = -1
  if (!occlusion) return
  for (const light of lights)
    light.entry.mapCaches.forEach((map, index) =>
      recordOcclusionView(map.occlusionView, map.projectionData, light.firstId + index),
    )
}

/** True when a cache entry got no id this frame: the page table is short. */
function anyUnallocated(cache: VsmCacheManager) {
  for (const entry of cache.entries.values()) if (entry.mapId < 0) return true
  return false
}

/** The frame's uniform counts. */
function frameUniforms(state: VsmFrameState, ids: VsmMapIds) {
  const { shadows } = state.maps
  const uniforms: VsmFrameUniforms = {
    mapCount: ids.mapCount,
    frameStamp: state.frameStamp,
    pressureBias: state.cache.pressureBias,
    detailPixelsStatic: shadows.shadowCoarsePagePixelThresholdStatic,
    detailPixelsDynamic: shadows.shadowCoarsePagePixelThresholdDynamic,
    // The option is thousandths of the distance.
    normalBias: shadows.shadowNormalBias / 1000,
    screenRayLength: shadows.shadowScreenRayLength,
    pageKeepFrames: shadows.shadowCacheMaxPageAgeSinceLastRequest,
    adaptiveRayCount: shadows.shadowSmrtAdaptiveRayCount,
    traceConeCot: focalScale(shadows.shadowSmrtMaxRayAngleFromLight),
    traceReachSun: shadows.shadowSmrtRayLengthScaleDirectional,
    traceSlopeCapLocal: shadows.shadowSmrtExtrapolateMaxSlopeLocal,
    traceSlopeCapSun: shadows.shadowSmrtExtrapolateMaxSlopeDirectional,
    tracePlaneBiasCap: shadows.shadowSmrtMaxSlopeBiasLocal,
    traceDitherLocal: shadows.shadowSmrtTexelDitherScaleLocal,
    traceDitherSun: shadows.shadowSmrtTexelDitherScaleDirectional,
    mipModeLocal: shadows.shadowMarkPixelPagesMipModeLocal,
    deferredBudget: shadows.shadowDeferredInvalidationBudget,
    lodDeltaInvalidates: shadows.shadowInvalidateOnLodDelta ? 1 : 0,
    dof: state.maps.dof,
    subsurfaceMinSourceRadius: Math.sin(0.5 * shadows.shadowSubsurfaceMinSourceAngle * DEG2RAD),
    onePassMaxLights: shadows.shadowOnePassProjectionMaxLightsPerPixel,
    cullBackfacing: shadows.shadowCullBackfacingPixels,
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
  cache.shadows = state.maps.shadows
  cache.beginFrame(state.frameStamp, camera.viewId)
  cache.poolPages = layout.poolPages
  dropRemovedLights(state, lights)
  scheduleDistantUpdates(cache, state.maps.shadows.shadowMaxDistantUpdatePerFrame)
  const casting = castingScratch
  casting.length = 0
  for (const l of lights) if (vsmShadowed(l)) casting.push(l)
  const { ids, allocations } = allocateFrameLights(state, casting, camera, viewport)
  projectedScratch.length = 0
  firstPersonScratch.clear()
  for (const a of allocations) {
    if (a.firstPerson) firstPersonScratch.set(a.id, a.firstId)
    else projectedScratch.push(a)
  }
  const uniforms = frameUniforms(state, ids)
  const blocks = packTables(state, allocations)
  if (blocks > layout.fullMapCapacity && grow?.(blocks)) layout = resources.layout
  const plan: VsmFramePlan = {
    frameStamp: state.frameStamp,
    projectionCount: ids.mapCount,
    tableBlocks: blocks,
    lights: allocations,
    projected: projectedScratch,
    firstPersonOf: firstPersonScratch,
    uniforms,
    nextMapCount: ids.nextMapCount,
    mapsAsked: ids.mapCount + ids.refusedMaps,
    overflow:
      blocks > layout.fullMapCapacity ||
      anyUnallocated(cache) ||
      (ids.refusedMaps > 0 && layout.mapSlots < 1 << VSM_RECORD_MAP_ID_BITS) ||
      ids.nextMapCount > layout.mapSlots,
  }
  if (plan.overflow) return plan
  recordOcclusionViews(cache, allocations, layout.occlusion)
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
