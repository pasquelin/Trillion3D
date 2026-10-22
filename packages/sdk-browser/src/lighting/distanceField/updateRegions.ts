import {
  clampCameraOffset,
  clipmapExtent,
  pageTableClipmapResolution,
  updatesThisFrame,
  GLOBAL_DISTANCE_FIELD_MAX_CLIPMAPS,
} from '../../../../sdk-core/src/lighting/globalDistanceField.ts'
import type { GlobalDistanceFieldSettings } from '../../../../sdk-core/src/contracts/globalDistanceFieldOptions.ts'
import { CACHE_FULL, CACHE_STATIC, type ModifiedBoxes } from './objectTracker.ts'
import {
  pageSizeOf,
  placeAt,
  reachingRegions,
  slabBound,
  wholeBound,
  type Placed,
  type UpdateBound,
  type Vec3,
} from './regionBounds.ts'

/**
 * WHERE EACH CLIPMAP LIES AND WHAT OF IT TO COMPOSITE AGAIN, frame by frame: the part of the global
 * distance field that lives on the host.
 *
 * A clipmap is a cube centred on the camera, snapped to a whole page; as the camera moves it
 * scrolls — its contents are not moved, only addressed with an offset, and the slab the camera
 * uncovered is composited — and a placement that changed names the region it changed. A clipmap
 * is composited whole when it has never been, when the settings or the scene changed under it, on
 * request, when too many regions changed, and when the meshes it held were not all streamed in and
 * now are. Which clipmaps are looked at in a frame follows `updateFrequency`. With the static
 * meshes cached apart, the movable clipmap inherits the regions of the static one.
 */

/** The regions a clipmap may name before it is composited whole, and the frames its phase counts. */
const MAX_PARTIAL_REGIONS = 1024
const MAX_UPDATE_INDEX = 128

/** Why a clipmap is composited whole, for the labels of its passes. */
export type FullReason = '' | 'TooManyUpdateBounds' | 'RecacheForStreaming' | 'MeshStreaming'

/** One clipmap of one cache in one frame. */
export interface ClipmapPlan {
  readonly index: number
  /** The centre, centimetres, and the half-side. */
  center: Vec3
  extent: number
  /** The scroll that addresses its contents, centimetres. */
  scroll: Vec3
  updates: UpdateBound[]
  reason: FullReason
}

/** What a clipmap remembers between frames. */
interface ClipmapMemory {
  fullOrigin: Vec3
  lastOrigin: Vec3
  extent: number
  separately: boolean
  token: unknown
  /** The regions changed since this clipmap last updated, per cache. */
  modified: [number[], number[]]
  /** Whether this frame composites it whole whatever its turn. */
  forced: boolean
}

/** The state kept from frame to frame. */
export function createRegionState() {
  return {
    updateIndex: 0,
    updateFrame: 0,
    firstFrame: true,
    initialized: false,
    pendingReset: false,
    forcedOnce: false,
    updatedThisFrame: false,
    cameraOffset: [0, 0, 0] as Vec3,
    previousOrigin: undefined as Vec3 | undefined,
    /** The clipmaps whose update waits for the meshes to be streamed in, per cache. */
    deferred: [[], []] as [number[], number[]],
    clipmaps: Array.from({ length: GLOBAL_DISTANCE_FIELD_MAX_CLIPMAPS }, (): ClipmapMemory => ({
      fullOrigin: [0, 0, 0],
      lastOrigin: [0, 0, 0],
      extent: 0,
      separately: true,
      token: undefined,
      modified: [[], []],
      forced: false,
    })),
  }
}
export type RegionState = ReturnType<typeof createRegionState>

/** What a frame's planning reads. */
export interface RegionInputs {
  readonly settings: GlobalDistanceFieldSettings
  readonly clipmaps: number
  /** The camera, centimetres. */
  readonly origin: Vec3
  readonly frame: number
  /** Seconds since the frame before. */
  readonly delta: number
  /** The regions changed since the last frame, per cache. */
  readonly modified: ModifiedBoxes
  /** A token that changes when the scene's meshes or their fields were remade. */
  readonly token: unknown
  /** Whether a buffer the field shares was made anew: every clipmap is composited whole. */
  readonly reallocated: boolean
  /** Whether a mesh's mip is still to be streamed in. */
  readonly pendingStreaming: boolean
}

/** What a frame's planning decided: the plans of the clipmaps of each cache. */
export interface RegionPlan {
  readonly caches: [ClipmapPlan[], ClipmapPlan[]]
  /** Whether the page tables and the free list begin again before the update. */
  readonly reset: boolean
}

/** The camera's offset by its velocity, taken forward one frame: the fast camera mode alone keeps one. */
function moveCameraOffset(state: RegionState, input: RegionInputs) {
  const { settings, origin, clipmaps } = input
  if (!settings.globalDistanceFieldFastCameraMode || !state.previousOrigin || clipmaps === 0)
    return void (state.cameraOffset = [0, 0, 0])
  const decay = Math.pow(settings.globalDistanceFieldCameraVelocityDecay, input.delta)
  const moved = state.cameraOffset.map((o, k) => o * decay + origin[k] - state.previousOrigin![k])
  state.cameraOffset = [...clampCameraOffset(moved as Vec3, settings, clipmaps - 1)] as Vec3
}

/** The camera's place for clipmap `index`: its position moved ahead by the velocity offset. */
const originOf = (state: RegionState, input: RegionInputs, index: number) =>
  clampCameraOffset(state.cameraOffset, input.settings, index).map(
    (o, k) => o + input.origin[k],
  ) as Vec3

/** What one cache of one clipmap is planned from. */
interface CacheCase {
  readonly cache: number
  readonly where: Placed
  readonly plan: ClipmapPlan
  /** The plan of the static cache, which the movable one inherits the regions of. */
  readonly inherited?: ClipmapPlan
}

/** Fills the plan of one cache of a clipmap that updates with the regions to composite again. */
function planCache(state: RegionState, input: RegionInputs, memory: ClipmapMemory, c: CacheCase) {
  const { settings } = input
  const { where, plan } = c
  const partial = settings.globalDistanceFieldPartialUpdates && !memory.forced
  const own = reachingRegions(
    memory.modified[c.cache],
    [...where.min, ...where.max],
    where.influence,
  )
  plan.updates = own
  if (partial && c.inherited) plan.updates.push(...c.inherited.updates)
  else if (partial) {
    const move = where.pages.map((p, k) => p - memory.lastOrigin[k]) as Vec3
    for (let axis = 0; axis < 3; axis++) {
      const slab = slabBound(move, where.min, where.max, where.pageSize, axis)
      if (slab) plan.updates.push(slab)
    }
  }
  const everything = [wholeBound(where.snapped, where.extent)]
  const take = (reason: ClipmapPlan['reason']) => (
    (plan.updates = everything),
    (plan.reason = reason)
  )
  if (!partial || own.length >= MAX_PARTIAL_REGIONS) take('TooManyUpdateBounds')
  if (settings.globalDistanceFieldForceRecacheOnStreaming) take('RecacheForStreaming')
  const waiting = state.deferred[c.cache].indexOf(plan.index)
  if (!input.pendingStreaming && waiting >= 0) {
    state.deferred[c.cache].splice(waiting, 1)
    take('MeshStreaming')
  }
  memory.modified[c.cache] = []
}

/** The plans one clipmap adds to each cache that is kept. */
function openPlans(
  first: number,
  index: number,
  extent: number,
  plans: [ClipmapPlan[], ClipmapPlan[]],
) {
  const own: ClipmapPlan[] = []
  for (let cache = first; cache <= CACHE_FULL; cache++) {
    own[cache] = { index, center: [0, 0, 0], extent, scroll: [0, 0, 0], updates: [], reason: '' }
    plans[cache].push(own[cache])
  }
  return own
}

/** Plans clipmap `index` in every cache: its regions where it updates, its place always. */
function planClipmap(
  state: RegionState,
  input: RegionInputs,
  index: number,
  plans: [ClipmapPlan[], ClipmapPlan[]],
) {
  const { settings } = input
  const memory = state.clipmaps[index]
  const separately = settings.globalDistanceFieldCacheMostlyStaticSeparately
  const first = separately ? CACHE_STATIC : CACHE_FULL
  const extent = clipmapExtent(settings, index)
  input.modified.forEach((boxes, cache) =>
    memory.modified[separately ? cache : CACHE_FULL].push(...boxes),
  )
  memory.forced =
    input.reallocated ||
    !state.initialized ||
    memory.extent !== extent ||
    memory.separately !== separately ||
    memory.token !== input.token ||
    settings.globalDistanceFieldForceFullUpdate ||
    state.forcedOnce
  const own = openPlans(first, index, extent, plans)
  const turn =
    settings.globalDistanceFieldUpdate &&
    updatesThisFrame(settings, index, input.clipmaps, state.updateIndex)
  if ((turn || memory.forced) && !state.updatedThisFrame) {
    const where = placeAt(settings, index, originOf(state, input, index))
    if (!settings.globalDistanceFieldPartialUpdates || memory.forced) {
      memory.fullOrigin = where.pages
      state.initialized = true
      state.pendingReset = true
      memory.token = input.token
    }
    for (let cache = first; cache <= CACHE_FULL; cache++)
      planCache(state, input, memory, {
        cache,
        where,
        plan: own[cache],
        inherited: separately && cache === CACHE_FULL ? own[CACHE_STATIC] : undefined,
      })
    memory.lastOrigin = where.pages
  }
  const pageSize = pageSizeOf(settings, index)
  const pages = pageTableClipmapResolution(settings)
  for (let cache = first; cache <= CACHE_FULL; cache++) {
    own[cache].center = memory.lastOrigin.map((p) => p * pageSize) as Vec3
    own[cache].scroll = memory.lastOrigin.map(
      (p, k) => ((p - memory.fullOrigin[k]) % pages) * pageSize,
    ) as Vec3
  }
  memory.extent = extent
  memory.separately = separately
}

/** The clipmaps' plans for a frame, and the state moved on. */
export function planRegions(state: RegionState, input: RegionInputs): RegionPlan {
  state.updatedThisFrame = !state.firstFrame && state.updateFrame === input.frame
  if (!state.updatedThisFrame) {
    state.updateIndex = state.updateIndex + 1 > MAX_UPDATE_INDEX ? 0 : state.updateIndex + 1
    moveCameraOffset(state, input)
  }
  const plans: [ClipmapPlan[], ClipmapPlan[]] = [[], []]
  for (let index = 0; index < input.clipmaps; index++) planClipmap(state, input, index, plans)
  state.forcedOnce = false
  state.previousOrigin = [...input.origin]
  return { caches: plans, reset: state.pendingReset }
}

/** The frame was planned: the first frame is over, and the page tables begin again no more once
 *  the update that did it was encoded. */
export function endFrame(state: RegionState, frame: number, encoded: boolean) {
  state.firstFrame = false
  state.updateFrame = frame
  if (encoded) state.pendingReset = false
}
