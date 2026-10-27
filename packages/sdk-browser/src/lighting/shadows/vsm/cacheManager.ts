/**
 * CPU side of the virtual shadow map cache: the array-level cache manager, which holds one entry
 * per light (`lightCache.ts`) keyed by its scene id, view and shadow type, and the pool pressure
 * bias fed back from the GPU free page count.
 */
import {
  VSM_PRESSURE_CALM_FRAMES,
  VSM_VIEW_SLOTS,
  VSM_POOL_PAGES,
  VSM_MAP_UNSEEN,
  VSM_PRESSURE_RISE,
  VSM_PRESSURE_FALL,
} from './constants.ts'
import { clamp, clampLowWins } from '../../../../../math/src/scalar/reals.ts'
import { VsmLightCache, vsmCacheKey, type VsmShadowType } from './lightCache.ts'
import type { VsmMapIds } from './mapIds.ts'
import type { ShadowValues } from '../../../../../sdk-core/src/contracts/shadowOptions.ts'
import { VSM_DEFAULT_SHADOWS, type VsmLightMove } from './mapSettings.ts'

interface VsmCacheManagerOptions {
  /** Whether the cache is on, default 1. */
  cacheEnabled?: boolean
  /** PoolPages of the pool (the feedback denominator). */
  poolPages?: number
}

/** The array-level cache manager (CPU part). */
export class VsmCacheManager {
  readonly cacheEnabled: boolean
  poolPages: number
  readonly entries = new Map<string, VsmLightCache>()
  /** The view's shadow settings the cache reads (the ages, the dynamic resolution's limits), set each frame. */
  shadows: ShadowValues = VSM_DEFAULT_SHADOWS
  /** The scene frame each light last moved at and the pose it was last asked at, by its id
   *  (`vsmLightPose`): the light's, not its entries', which are dropped and made again as it
   *  leaves and comes back into view; gone with the light (`dropRemovedLights`). */
  readonly lightMoves = new Map<string, VsmLightMove>()
  /** The scene frame the distant lights' schedule last turned at (`scheduleDistantUpdates`); -1
   *  never. */
  distantRotatedAt = -1
  /** The pool pressure bias. */
  pressureBias = 0
  private lastFrameOverBudget = 0
  /** The scene frame number of the frame being set up. */
  frameStamp = 0
  /** Previous frame's map count; null = no cache data. */
  prevFrame: { mapCount: number; sunBase: number } | null = null
  /** The views drawn, in the order they were first set up. Views drawn in turn (`world.addView`)
   *  each keep their suns' clipmaps, centred on their own eyes, and share the local lights' maps and
   *  the pool. */
  private readonly views = new Set<string>()
  constructor(options: VsmCacheManagerOptions = {}) {
    this.cacheEnabled = options.cacheEnabled ?? true
    this.poolPages = options.poolPages ?? VSM_POOL_PAGES
  }

  hasPreviousFrame() {
    return this.cacheEnabled && this.prevFrame !== null
  }

  /** The invalidations run only over a previous frame's maps: cache data and slots. */
  acceptsInvalidations() {
    return this.hasPreviousFrame() && (this.prevFrame?.mapCount ?? 0) > 0
  }

  /** Frame `frameStamp` is set up, for `view` (`''` the main one): no entry is referenced yet. Every
   *  entry ages by this one counter, whatever view drew it. */
  beginFrame(frameStamp: number, view = '') {
    this.frameStamp = frameStamp
    this.views.add(view)
    for (const entry of this.entries.values()) entry.seenThisFrame = false
  }

  /** The place of `view` among the views drawn, in the order they were first set up (`beginFrame`),
   *  0 for the main view and for the maps all views share; the most views whose cache state a map
   *  reads is `VSM_VIEW_SLOTS`. */
  viewSlotOf(view: string | undefined) {
    if (view === undefined) return 0
    let slot = 0
    for (const seen of this.views) {
      if (seen === view) return Math.min(slot, VSM_VIEW_SLOTS - 1)
      slot++
    }
    return 0
  }

  /** The views drawn, at most `VSM_VIEW_SLOTS`. */
  get viewCount() {
    return clampLowWins(this.views.size, 1, VSM_VIEW_SLOTS)
  }

  /** Finds or creates a light's cache entry: `view`'s own (`''` the main one's), or, with none,
   *  the one every view shares; a sun's first-person clipmap (`typeTag` 1) apart from its regular
   *  one, both under the light's own id. */
  lightEntryFor(lightId: string, mapCount: number, view?: string, typeTag: VsmShadowType = 0) {
    const key = vsmCacheKey(lightId, view, typeTag)
    let entry = this.entries.get(key)
    // Level count changed: dropped and recreated.
    if (entry && entry.mapCaches.length !== mapCount) entry = undefined
    if (!entry) this.entries.set(key, (entry = new VsmLightCache(lightId, mapCount, view, typeTag)))
    entry.seenThisFrame = true
    entry.lastSeenFrame = this.frameStamp
    return entry
  }

  /** `view` is no longer drawn: its entries go, their pages freed as any unreferenced map's. */
  dropView(view: string) {
    for (const [key, entry] of this.entries) if (entry.view === view) this.entries.delete(key)
    this.views.delete(view)
  }

  /** Claims ids for the entries no light referenced this frame, which keep their pages until they age
   *  out (`shadowCacheMaxLightAgeSinceLastRequest` frames since a light last asked them). */
  claimUnseenLights(ids: VsmMapIds) {
    for (const entry of this.entries.values())
      if (
        !entry.seenThisFrame &&
        ((this.frameStamp - entry.lastSeenFrame) | 0) <=
          this.shadows.shadowCacheMaxLightAgeSinceLastRequest
      )
        ids.claim(entry, 'unreferenced')
  }

  /** The frame's plan is kept: the entries that claimed no id aged out and go, every other moves to the
   *  id it claimed (`VsmMapIds.claim`), an entry no light referenced as the inactive map it is, and each
   *  map that had an id leaves its next-map data under it. */
  commitIds(ids: VsmMapIds) {
    for (const [key, entry] of this.entries) if (!ids.holds(entry)) this.entries.delete(key)
    for (let i = 0; i < ids.claimCount; i++) {
      const { entry, id, unreferenced } = ids.claims[i]
      entry.moveToMapId(id)
      if (unreferenced)
        for (const map of entry.mapCaches) {
          map.update(entry)
          map.projectionData.flags = (map.projectionData.flags | VSM_MAP_UNSEEN) >>> 0
        }
      const prevId = entry.prevMapId
      if (prevId < 0) continue
      for (let index = 0; index < entry.mapCaches.length; index++) {
        const map = entry.mapCaches[index]
        map.nextMaps.nextMapId = id + index
        ids.writeNextMap(prevId + index, map.nextMaps)
      }
    }
  }

  /** The frame was planned but not run, its plan dropped. The ids stand (they move at `commitIds`); the
   *  setup of a sun's clipmap moved its panned origin, which the pages the GPU holds, those of the last
   *  frame run, were drawn without: those clipmaps draw afresh. A local light's setup keeps nothing
   *  of the kind, its changes (`updateLocal`) invalidate for good. */
  dropFrame() {
    for (const entry of this.entries.values())
      if (entry.seenThisFrame && entry.clipmap) entry.invalidate()
  }

  /**
   * Extracts the frame data (CPU part): a frame that allocated shadow data replaces the previous
   * frame's (`frame`); a frame without (`null`) keeps it.
   */
  keepFrameForNext(frame: { mapCount: number; sunBase: number } | null) {
    if (frame) this.prevFrame = this.cacheEnabled ? { ...frame } : null
  }

  /** Invalidates: drops the previous frame's buffers and has every light drawn uncached again
   *  (all pages become uncached); the entries and their ids stand. */
  invalidate() {
    this.prevFrame = null
    for (const entry of this.entries.values()) entry.invalidate()
  }

  /** Processes the removed lights: entries of removed lights go (their ids may be reused), and
   *  the frame they moved at and the pose they were at. */
  dropRemovedLights(isRemoved: (lightId: string) => boolean) {
    for (const [key, entry] of this.entries) if (isRemoved(entry.lightId)) this.entries.delete(key)
    for (const lightId of this.lightMoves.keys())
      if (isRemoved(lightId)) this.lightMoves.delete(lightId)
  }

  /** Free AVAILABLE pages of the last status message read back (diagnostics). */
  lastFreePages = 0

  /**
   * The page-management status feedback handler: `freePages` is the
   * GPU's last free physical page count (negative on overflow), `lastPressureBias` the bias that
   * frame used. Returns the new global bias, read by the next frame's setup and uniforms.
   */
  readPoolFeedback(freePages: number, lastPressureBias: number) {
    this.lastFreePages = freePages
    const load = Math.fround(this.shadows.shadowDynamicResolutionMaxPagePoolLoadFactor)
    const frameStamp = this.frameStamp >>> 0
    // A load of 0 turns the dynamic resolution off: the bias stays where it is, held to its limit.
    if (load > 0) {
      const currentAllocation = Math.fround(1 - Math.fround(freePages / this.poolPages))
      const allocationRatio = Math.fround(currentAllocation / load)
      const targetBias = Math.fround(Math.max(0, lastPressureBias + Math.log2(allocationRatio)))
      if (currentAllocation > load) {
        this.lastFrameOverBudget = frameStamp
        this.pressureBias = approach(this.pressureBias, targetBias, VSM_PRESSURE_RISE)
      } else if ((frameStamp - this.lastFrameOverBudget) >>> 0 > VSM_PRESSURE_CALM_FRAMES)
        this.pressureBias = approach(this.pressureBias, targetBias, VSM_PRESSURE_FALL)
    }
    this.pressureBias = clamp(
      this.pressureBias,
      0,
      this.shadows.shadowDynamicResolutionMaxResolutionLodBias,
    )
    return this.pressureBias
  }
}

/** `from` moved `share` of the way to `to` as a float lerp does: a rounding at each of the three
 *  operations, so the step stalls on a subnormal above 0 when it stops moving the value. */
function approach(from: number, to: number, share: number) {
  return Math.fround(from + Math.fround(share * Math.fround(to - from)))
}
