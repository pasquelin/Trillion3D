/**
 * CPU side of the virtual shadow map cache: the array-level cache manager, the per-light cache
 * entries and the per-map cache entries.
 *
 * What it holds across frames: one entry per light, keyed by its scene id — a sun's clipmap,
 * centred on the eye, one per view (`VsmCacheManager.view`) —, each with one entry per shadow map
 * (clipmap levels, 6 cube faces or 1 spot map) carrying the cached projection data, the clipmap
 * panning / depth range state and the next-map data the page management uses to carry pages from
 * the previous frame's ids to this frame's. Also the pool pressure bias fed back from the GPU free
 * page count.
 *
 * Units: the clipmap's depth state (`depthCentre`, `depthRadius`) is kept in
 * centimetres, the units of the clipmap's level arithmetic (`clipmap.ts`); the
 * projection data handed to the GPU is in metres (see `clipmap.ts`).
 */
import {
  VSM_SUN_DEPTH_KEEP,
  VSM_PRESSURE_LOAD,
  VSM_PRESSURE_BIAS_MAX,
  VSM_PRESSURE_CALM_FRAMES,
  VSM_PRESSURE_HOLD,
  VSM_LIGHT_KEEP_FRAMES,
  VSM_POOL_PAGES,
  VSM_NEXT_KEEPS_PAGES,
  VSM_MAP_UNSEEN,
  VSM_PRESSURE_RISE,
  VSM_PRESSURE_FALL,
  VSM_FEEDBACK_POOL,
} from './constants.ts'
import { sameValues } from '../../../math/src/matrix/matrixElements.ts'
import { vsmDefaultProjectionData, type VsmProjectionDataValues } from './projectionData.ts'
import { createReadbackRing, type ReadbackRing } from '../gpu/core/readbackRing.ts'
import { vsmDemandPages } from './poolDraw.ts'
import { clamp, lerp } from '../../../math/src/scalar/reals.ts'
import type { VsmClipmap } from './clipmap.ts'
import type { VsmLocalLightSetup } from './localLight.ts'

/** The next-frame map data, 16 bytes on the GPU (`VsmNextMap`). */
export interface VsmNextMap {
  flags: number
  nextMapId: number
  pageShift: [number, number]
}

/** What the per-light setup needs of the id allocator (see `frameSetup.ts`). */
export interface VsmIdAllocator {
  allocateUnreferenced(count: number): number
  writeNextMap(prevMapId: number, data: VsmNextMap): void
  fits(count: number): boolean
  readonly mapCount: number
}

/** A clipmap level's cache state, centimetres. */
interface VsmLevelCache {
  levelPageOrigin: [number, number]
  depthCentre: number
  depthRadius: number
}

/** One shadow map's cache entry (clipmap level, cube face or spot map). */
export class VsmMapCache {
  nextMaps: VsmNextMap = { flags: 0, nextMapId: -1, pageShift: [0, 0] }
  /** Cached projection data, kept for inactive (unreferenced) maps too. */
  projectionData: VsmProjectionDataValues = vsmDefaultProjectionData()
  clipmap: VsmLevelCache = {
    levelPageOrigin: [0, 0],
    depthCentre: 0,
    depthRadius: 0,
  }

  /** Updates a clipmap level's cache state (centimetres). */
  updateLevel(
    perLight: VsmLightCache,
    levelPageOrigin: [number, number],
    levelRadius: number,
    depthCentre: number,
    depthRadius: number,
  ) {
    const c = this.clipmap
    let cacheValid = perLight.renderedFrame >= 0
    cacheValid = cacheValid && depthRadius === c.depthRadius
    if (cacheValid) {
      const deltaZ = Math.abs(depthCentre - c.depthCentre)
      if (deltaZ + levelRadius > VSM_SUN_DEPTH_KEEP * c.depthRadius) cacheValid = false
    }
    if (cacheValid) {
      // Leave the view centre and radius where they were for the cached pages.
      this.nextMaps.flags = VSM_NEXT_KEEPS_PAGES
      this.nextMaps.pageShift[0] = levelPageOrigin[0] - c.levelPageOrigin[0]
      this.nextMaps.pageShift[1] = levelPageOrigin[1] - c.levelPageOrigin[1]
    } else {
      this.nextMaps.flags = 0
      this.nextMaps.pageShift[0] = this.nextMaps.pageShift[1] = 0
      c.depthCentre = depthCentre
      c.depthRadius = depthRadius
    }
    c.levelPageOrigin[0] = levelPageOrigin[0]
    c.levelPageOrigin[1] = levelPageOrigin[1]
  }

  /** Update for local lights and inactive lights. */
  update(perLight: VsmLightCache) {
    if (perLight.renderedFrame >= 0) {
      this.nextMaps.flags = VSM_NEXT_KEEPS_PAGES
      this.nextMaps.pageShift[0] = this.nextMaps.pageShift[1] = 0
    } else {
      this.nextMaps.flags = 0
    }
  }
}

/** A clipmap's cache key: a change invalidates. */
interface VsmSunCacheKey {
  lightDirection: [number, number, number]
  firstLevel: number
}

/** A local light's cache key: a change invalidates. `shape` is what recreating the light's
 *  proxy, hence its cache entry, keys by: light type (0 point, 1 spot), range and
 *  outer cone angle — a change of any of them reprojects every map. */
interface VsmLocalLightCacheKey {
  worldToLight: ArrayLike<number>
  lightOriginShift: [number, number, number]
  shape: [number, number, number]
}

/** `from`'s values into `to`, its length made theirs. */
function copyInto(to: number[], from: ArrayLike<number>) {
  to.length = from.length
  for (let k = 0; k < from.length; k++) to[k] = from[k]
}

/** One light's cache entry. */
export class VsmLightCache {
  renderedFrame = -1
  prevMapId = -1
  mapId = -1
  isUncached = false
  useCover = false
  seenThisFrame = false
  lastSeenFrame = 0
  readonly mapCaches: VsmMapCache[]
  /** The keys of the last frame, rewritten in place when they change. */
  private localCacheKey: VsmLocalLightCacheKey & { worldToLight: number[] } = {
    worldToLight: [],
    lightOriginShift: [0, 0, 0],
    shape: [Number.NaN, Number.NaN, Number.NaN],
  }
  private clipmapCacheKey: VsmSunCacheKey = { lightDirection: [NaN, NaN, NaN], firstLevel: 0 }
  /** A sun's clipmap (`buildVsmClipmap`), a local light's setup (`addVsmLocalLightShadow`): kept
   *  with the entry, rewritten in place every frame, made anew with a new entry. */
  clipmap?: VsmClipmap
  localSetup?: VsmLocalLightSetup

  readonly lightId: string
  /** The view it is drawn for: a sun's clipmap's (`''` the main view's); none for a local light's
   *  maps, which every view shares. */
  readonly view: string | undefined
  /** Its key in the cache's entries: the light's id, then the view's past the main one. */
  readonly key: string

  constructor(lightId: string, mapCount: number, view?: string, key = lightId) {
    this.lightId = lightId
    this.view = view
    this.key = key
    this.mapCaches = Array.from({ length: mapCount }, () => new VsmMapCache())
  }

  markRendered(frameIndex: number) {
    this.renderedFrame = frameIndex
  }
  invalidate() {
    this.renderedFrame = -1
  }
  isInvalidated() {
    return this.renderedFrame < 0
  }
  /** The collector's filter: an entry that may hold cached pages to invalidate — neither
   *  uncached nor invalidated, and given an id. */
  mayHoldCachedPages() {
    return !(this.isUncached || this.isInvalidated()) && this.mapId >= 0
  }
  moveToMapId(next: number) {
    this.prevMapId = this.mapId
    this.mapId = next
  }

  /** Invalidates the entry for a changed key, a forced invalidation or a cover turned on or off;
   *  a cached <-> uncached transition invalidates too. */
  private updateCommon(keyChanged: boolean, forceInvalidate: boolean, useCover: boolean) {
    if (forceInvalidate || keyChanged) this.renderedFrame = -1
    if (useCover !== this.useCover) {
      this.renderedFrame = -1
      this.useCover = useCover
    }
    // An invalidated light renders the next frame uncached; uncached <-> cached transitions invalidate.
    const newIsUncached = this.renderedFrame < 0
    if (newIsUncached !== this.isUncached) {
      this.renderedFrame = -1
      this.isUncached = newIsUncached
    }
  }

  /** Updates a clipmap's cache entry. */
  updateClipmap(key: VsmSunCacheKey, forceInvalidate: boolean) {
    const k = this.clipmapCacheKey
    const changed =
      !sameValues(key.lightDirection, k.lightDirection) || key.firstLevel !== k.firstLevel
    this.updateCommon(changed, forceInvalidate, true)
    if (changed) {
      copyInto(k.lightDirection, key.lightDirection)
      k.firstLevel = key.firstLevel
    }
  }

  /** Updates a local light's cache entry. */
  updateLocal(key: VsmLocalLightCacheKey, forceInvalidate: boolean) {
    const k = this.localCacheKey
    const changed =
      !sameValues(key.worldToLight, k.worldToLight) ||
      !sameValues(key.lightOriginShift, k.lightOriginShift) ||
      !sameValues(key.shape, k.shape)
    this.updateCommon(changed, forceInvalidate, false)
    if (changed) {
      copyInto(k.worldToLight, key.worldToLight)
      copyInto(k.lightOriginShift, key.lightOriginShift)
      copyInto(k.shape, key.shape)
    }
  }
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

  /** The frames `entry` ages by: its view's, or every frame for maps all views share. */
  private stampOf({ view }: VsmLightCache) {
    return view === undefined ? this.frameStamp : (this.viewFrames.get(view) ?? 0)
  }

  /** The key of light `lightId`'s entry for `view`: the light's id for the main view's and for the
   *  maps every view shares (no `view`), then the view's past it. */
  private keyOf(lightId: string, view: string | undefined) {
    return view ? `${lightId}#${view}` : lightId
  }

  /** Finds or creates a light's cache entry: `view`'s own (`''` the main one's), or, with none,
   *  the one every view shares. */
  lightEntryFor(lightId: string, mapCount: number, view?: string) {
    const key = this.keyOf(lightId, view)
    let entry = this.entries.get(key)
    // Level count or kind changed: dropped and recreated.
    if (entry && (entry.mapCaches.length !== mapCount || entry.view !== view)) entry = undefined
    if (!entry) this.entries.set(key, (entry = new VsmLightCache(lightId, mapCount, view, key)))
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
        ((this.stampOf(entry) - entry.lastSeenFrame) | 0) <= VSM_LIGHT_KEEP_FRAMES &&
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
  /** The pages the last fill read back asks of the pool (`vsmDemandPages`), 0 within its load:
   *  what grows the next set (`regrowEngineVsm`). */
  demandPages = 0

  /**
   * The page-management status feedback handler: `freePages` is the
   * GPU's last free physical page count (negative on overflow), `lastPressureBias` the bias that
   * frame used. Returns the new global bias, read by the next frame's setup and uniforms.
   */
  readPoolFeedback(freePages: number, lastPressureBias: number) {
    this.lastFreePages = freePages
    this.demandPages = vsmDemandPages(this.poolPages, freePages, lastPressureBias)
    const frameStamp = this.frameStamp >>> 0
    const currentAllocation = Math.fround(1 - Math.fround(freePages / this.poolPages))
    const allocationRatio = Math.fround(currentAllocation / Math.fround(VSM_PRESSURE_LOAD))
    const targetBias = Math.fround(Math.max(0, lastPressureBias + Math.log2(allocationRatio)))
    const over = currentAllocation > Math.fround(VSM_PRESSURE_LOAD)
    if (over) {
      this.lastFrameOverBudget = frameStamp
      this.pressureBias = approach(this.pressureBias, targetBias, VSM_PRESSURE_RISE)
    } else if (
      (frameStamp - this.lastFrameOverBudget) >>> 0 > VSM_PRESSURE_CALM_FRAMES &&
      (targetBias === 0 || Math.abs(this.pressureBias - targetBias) > VSM_PRESSURE_HOLD)
    )
      // Within a sixteenth of a level of a target above 0 it holds: the jitter's wander is no move.
      this.pressureBias = approach(this.pressureBias, targetBias, VSM_PRESSURE_FALL)
    this.pressureBias = clamp(this.pressureBias, 0, VSM_PRESSURE_BIAS_MAX)
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

/** Bytes the readback holds at most: `maxInFlight` copies of the 4-word message. */
export const vsmFeedbackReadbackBytes = (maxInFlight = 3) => maxInFlight * 16

/**
 * The GPU → CPU path of the status feedback message (the status feedback kernel): copies the 4-word
 * `feedback` buffer ([message id, free pages, pressure bias bits, scene frame]) into a mappable
 * buffer and, when it maps, feeds `VsmCacheManager.readPoolFeedback`. A few frames in flight,
 * never stalls.
 */
export class VsmFeedbackReadback {
  private readonly ring: ReadbackRing

  constructor(device: GPUDevice, cache: VsmCacheManager, maxInFlight = 3) {
    this.ring = createReadbackRing(
      device,
      { label: 'vsm.feedbackReadback', bytes: 16, count: maxInFlight },
      (mapped) => {
        const words = new Uint32Array(mapped)
        if (words[0] === (VSM_FEEDBACK_POOL as number))
          cache.readPoolFeedback(words[1] | 0, new Float32Array(mapped, 8, 1)[0])
      },
    )
  }

  /** Records the copy; returns false when every staging buffer is still in flight (skipped). */
  encode(encoder: GPUCommandEncoder, feedback: GPUBuffer) {
    const staging = this.ring.take()
    if (!staging) return false
    encoder.copyBufferToBuffer(feedback, 0, staging, 0, 16)
    return true
  }

  /** Call after `queue.submit` of the encoder given to `encode`. */
  afterSubmit() {
    this.ring.submitted()
  }

  destroy() {
    this.ring.destroy()
  }
}
