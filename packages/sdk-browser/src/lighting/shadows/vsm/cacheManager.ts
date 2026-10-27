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
import { clamp, clampLowWins, lerp } from '../../../../../math/src/scalar/reals.ts'
import { VsmLightCache, vsmCacheKey, type VsmNextMap, type VsmShadowType } from './lightCache.ts'
import type { ShadowValues } from '../../../../../sdk-core/src/contracts/shadowOptions.ts'
import { VSM_DEFAULT_SHADOWS } from './mapSettings.ts'

/** What the per-light setup needs of the id allocator (see `frameSetup.ts`). */
export interface VsmIdAllocator {
  allocateUnreferenced(count: number): number
  writeNextMap(prevMapId: number, data: VsmNextMap): void
  fits(count: number): boolean
  readonly mapCount: number
}

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
  /** The pool pressure bias. */
  pressureBias = 0
  private lastFrameOverBudget = 0
  /** The scene frame number of the frame being set up. */
  frameStamp = 0
  /** Previous frame's map count; null = no cache data. */
  prevFrame: { mapCount: number } | null = null
  /** The frames each view set up: a view's entry ages by its view's frames only. Views drawn in
   *  turn (`world.addView`) each keep their suns' clipmaps, centred on their own eyes, and share
   *  the local lights' maps and the pool. */
  private readonly viewFrames = new Map<string, number>()

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

  /** Frame `frameStamp` is set up, for `view` (`''` the main one): its frames counted. */
  beginFrame(frameStamp: number, view = '') {
    this.frameStamp = frameStamp
    this.viewFrames.set(view, (this.viewFrames.get(view) ?? 0) + 1)
  }

  /** The place of `view` among the views drawn, in the order they were first set up (`beginFrame`),
   *  0 for the main view and for the maps all views share; the most views whose cache state a map
   *  reads is `VSM_VIEW_SLOTS`. */
  viewSlotOf(view: string | undefined) {
    if (view === undefined) return 0
    let slot = 0
    for (const seen of this.viewFrames.keys()) {
      if (seen === view) return Math.min(slot, VSM_VIEW_SLOTS - 1)
      slot++
    }
    return 0
  }

  /** The views drawn, at most `VSM_VIEW_SLOTS`. */
  get viewCount() {
    return clampLowWins(this.viewFrames.size, 1, VSM_VIEW_SLOTS)
  }

  /** The frames `entry` ages by: its view's, or every frame for maps all views share. */
  private stampOf({ view }: VsmLightCache) {
    return view === undefined ? this.frameStamp : (this.viewFrames.get(view) ?? 0)
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
    entry.lastSeenFrame = this.stampOf(entry)
    return entry
  }

  /** `view` is no longer drawn: its entries go, their pages freed as any unreferenced map's. */
  dropView(view: string) {
    for (const [key, entry] of this.entries) if (entry.view === view) this.entries.delete(key)
    this.viewFrames.delete(view)
  }

  /** Updates the unreferenced cache entries: ids for inactive lights, ages out, writes next data. */
  carryUnseenLights(ids: VsmIdAllocator) {
    for (const [key, entry] of this.entries) {
      let keep = true
      if (entry.seenThisFrame) {
        if (entry.mapId + entry.mapCaches.length > ids.mapCount)
          throw new Error('VSM: referenced cache entry id out of range')
      } else if (
        ((this.stampOf(entry) - entry.lastSeenFrame) | 0) <=
          this.shadows.shadowCacheMaxLightAgeSinceLastRequest &&
        ids.fits(entry.mapCaches.length)
      ) {
        const numMaps = entry.mapCaches.length
        entry.moveToMapId(ids.allocateUnreferenced(numMaps))
        for (const map of entry.mapCaches) {
          map.update(entry)
          map.projectionData.flags = (map.projectionData.flags | VSM_MAP_UNSEEN) >>> 0
        }
      } else keep = false

      if (!keep) {
        this.entries.delete(key)
        continue
      }
      const prevId = entry.prevMapId
      if (prevId >= 0) {
        const baseId = entry.mapId
        if (baseId < 0) continue
        for (let index = 0; index < entry.mapCaches.length; index++) {
          const map = entry.mapCaches[index]
          map.nextMaps.nextMapId = baseId + index
          ids.writeNextMap(prevId + index, map.nextMaps)
        }
      }
    }
  }

  /**
   * Extracts the frame data (CPU part): a frame that allocated shadow data replaces the previous
   * frame's (`frame`); a frame without (`null`) keeps it.
   */
  keepFrameForNext(frame: { mapCount: number } | null) {
    if (frame) this.prevFrame = this.cacheEnabled ? { ...frame } : null
    for (const entry of this.entries.values()) entry.seenThisFrame = false
  }

  /** Invalidates: drops the previous frame's buffers (all pages become uncached). */
  invalidate() {
    this.prevFrame = null
  }

  /** Processes the removed lights: entries of removed lights go (their ids may be reused). */
  dropRemovedLights(isRemoved: (lightId: string) => boolean) {
    for (const [key, entry] of this.entries) if (isRemoved(entry.lightId)) this.entries.delete(key)
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

/** `from` moved `share` of the way to `to`, in f32, or `to` itself once that step no longer moves
 *  it: a geometric approach in f32 stalls where rounding returns the value it starts from (nine
 *  tenths of k·2^-149 round back to it for k ≤ 4), so the bias reaches its target, 0 included. */
function approach(from: number, to: number, share: number) {
  const next = Math.fround(lerp(from, to, share))
  return next === from ? to : next
}
