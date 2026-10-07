/**
 * CPU side of the virtual shadow map cache: the array-level cache manager, the per-light cache
 * entries and the per-map cache entries, plus the light mobility factor.
 *
 * What it holds across frames: one entry per light, keyed by its scene id, each with one
 * entry per shadow map (clipmap levels, 6 cube faces or 1 spot map) carrying the cached projection
 * data, the clipmap panning / depth range state and the next-map data the page
 * management uses to carry pages from the previous frame's ids to this frame's. Also the
 * pool pressure bias fed back from the GPU free page count.
 *
 * Units: the clipmap's depth state (`depthCentre`, `depthRadius`) is kept in
 * centimetres, the units of the clipmap's level arithmetic (`clipmap.ts`); the
 * projection data handed to the GPU is in metres (see `clipmap.ts`).
 */
import {
  VSM_CACHE_ON,
  VSM_SUN_DEPTH_KEEP,
  VSM_PRESSURE_LOAD,
  VSM_PRESSURE_BIAS_MAX,
  VSM_PRESSURE_BIAS_FLOOR,
  VSM_PRESSURE_CALM_FRAMES,
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
import { createVsmReadbackRing, type VsmReadbackRing } from './readbackRing.ts'
import { clamp, lerp, saturate } from '../../../math/src/scalar/reals.ts'

/** Frames a light stays active after its last change: its mobility factor falls over them. */
const VSM_LIGHT_ACTIVE_FRAME_COUNT = 10

/** The next-frame map data, 16 bytes on the GPU (`VsmNextMap`). */
export interface VsmNextMap {
  flags: number
  nextMapId: number
  pageShift: [number, number]
}

/** What the per-light setup needs of the id allocator (see `frameSetup.ts`). */
export interface VsmIdAllocator {
  allocateUnreferenced(singlePage: boolean, count: number): number
  writeNextMap(prevMapId: number, data: VsmNextMap): void
  readonly mapSlotCount: number
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
  isCachedFarLight: boolean
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
  scheduledFrame = -1
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
    isCachedFarLight: false,
    shape: [Number.NaN, Number.NaN, Number.NaN],
  }
  private clipmapCacheKey: VsmSunCacheKey = { lightDirection: [NaN, NaN, NaN], firstLevel: 0 }
  /** Rough bounds for invalidation culling, metres; radius < 0 = infinite. */
  lightOrigin: [number, number, number] = [0, 0, 0]
  lightRange = -1

  readonly lightId: string

  constructor(lightId: string, mapCount: number) {
    this.lightId = lightId
    this.mapCaches = Array.from({ length: mapCount }, () => new VsmMapCache())
  }

  /** A distant light that has been rendered: all its pages are mapped and rendered. */
  isFullyCached() {
    return this.localCacheKey.isCachedFarLight && this.renderedFrame >= 0
  }
  isCachedFarLight() {
    return this.localCacheKey.isCachedFarLight
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
  /** The collector's filter: an entry that may hold cached
   *  pages to invalidate — not fully cached, uncached or invalidated, and given an id. */
  mayHoldCachedPages() {
    return !(this.isFullyCached() || this.isUncached || this.isInvalidated()) && this.mapId >= 0
  }
  markScheduled(frameIndex: number) {
    this.scheduledFrame = frameIndex
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
  updateClipmap(key: VsmSunCacheKey, forceInvalidate: boolean, useCover: boolean) {
    const k = this.clipmapCacheKey
    const changed =
      !sameValues(key.lightDirection, k.lightDirection) || key.firstLevel !== k.firstLevel
    this.updateCommon(changed, forceInvalidate, useCover)
    if (changed) {
      copyInto(k.lightDirection, key.lightDirection)
      k.firstLevel = key.firstLevel
    }
    this.lightOrigin.fill(0)
    this.lightRange = -1
  }

  /** Updates a local light's cache entry. */
  updateLocal(
    key: VsmLocalLightCacheKey,
    lightOrigin: [number, number, number],
    lightRange: number,
    forceInvalidate: boolean,
    useCover: boolean,
  ) {
    const k = this.localCacheKey
    const changed =
      !sameValues(key.worldToLight, k.worldToLight) ||
      !sameValues(key.lightOriginShift, k.lightOriginShift) ||
      key.isCachedFarLight !== k.isCachedFarLight ||
      !sameValues(key.shape, k.shape)
    this.updateCommon(changed, forceInvalidate, useCover)
    if (changed) {
      copyInto(k.worldToLight, key.worldToLight)
      copyInto(k.lightOriginShift, key.lightOriginShift)
      k.isCachedFarLight = key.isCachedFarLight
      copyInto(k.shape, key.shape)
    }
    copyInto(this.lightOrigin, lightOrigin)
    this.lightRange = lightRange
  }

  /** Whether the light's range reaches a bounding sphere (metres). */
  affectsBounds(center: ArrayLike<number>, sphereRadius: number) {
    if (this.lightRange <= 0) return true
    const dx = center[0] - this.lightOrigin[0],
      dy = center[1] - this.lightOrigin[1],
      dz = center[2] - this.lightOrigin[2]
    return dx * dx + dy * dy + dz * dz <= (this.lightRange + sphereRadius) ** 2
  }
}

/** One instance range × one VSM id, with its payload: the VSM id. */
export interface VsmInstanceInvalidation {
  firstInstance: number
  instanceCount: number
  payload: number
}

/** One phase's invalidations, for the GPU invalidation pass. */
export interface VsmInvalidationBatch {
  /** Every (instance range, VSM id) pair; ids are the previous frame's. */
  instances: VsmInstanceInvalidation[]
}

/** The per-light cache state the scene renderer reads: the light mobility. */
interface LightMobility {
  firstActiveFrame: number
  mobilityFactor: number
  active: boolean
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
  /** Previous frame's uniform counts; null = no cache data . */
  prevFrame: {
    mapSlotCount: number
    fullMapCount: number
    singlePageMapCount: number
  } | null = null

  private mobility = new Map<string, LightMobility>()

  constructor(options: VsmCacheManagerOptions = {}) {
    this.cacheEnabled = options.cacheEnabled ?? (VSM_CACHE_ON as number) !== 0
    this.poolPages = options.poolPages ?? VSM_POOL_PAGES
  }

  hasPreviousFrame() {
    return this.cacheEnabled && this.prevFrame !== null
  }

  /** The invalidations run only over a previous frame's maps: cache data and slots. */
  acceptsInvalidations() {
    return this.hasPreviousFrame() && (this.prevFrame?.mapSlotCount ?? 0) > 0
  }

  /** Finds or creates a light's cache entry. */
  lightEntryFor(lightId: string, mapCount: number) {
    const found = this.entries.get(lightId)
    if (found) {
      if (found.mapCaches.length === mapCount) {
        found.seenThisFrame = true
        found.lastSeenFrame = this.frameStamp
        return found
      }
      this.entries.delete(lightId) // level count changed: drop and recreate
    }
    const entry = new VsmLightCache(lightId, mapCount)
    entry.seenThisFrame = true
    entry.lastSeenFrame = this.frameStamp
    this.entries.set(lightId, entry)
    return entry
  }

  /** Updates the unreferenced cache entries: ids for inactive lights, ages out, writes next data. */
  carryUnseenLights(ids: VsmIdAllocator) {
    const frameStamp = this.frameStamp
    for (const [key, entry] of this.entries) {
      let keep = true
      if (entry.seenThisFrame) {
        if (entry.mapId + entry.mapCaches.length > ids.mapSlotCount)
          throw new Error('VSM: referenced cache entry id out of range')
      } else if (((frameStamp - entry.lastSeenFrame) | 0) <= VSM_LIGHT_KEEP_FRAMES) {
        const numMaps = entry.mapCaches.length
        entry.moveToMapId(ids.allocateUnreferenced(entry.isCachedFarLight(), numMaps))
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
  keepFrameForNext(
    frame: {
      mapSlotCount: number
      fullMapCount: number
      singlePageMapCount: number
    } | null,
  ) {
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

  /** The distant (fully cached) light to refresh this frame: the oldest scheduled, one at most. */
  scheduleFarLights() {
    if (!this.cacheEnabled) return
    const frame = this.frameStamp | 0
    let oldest: VsmLightCache | null = null,
      oldestAge = 0
    for (const entry of this.entries.values()) {
      if (!entry.isFullyCached()) continue
      const age = (frame - (entry.scheduledFrame | 0)) | 0
      if (oldest === null || age > oldestAge) {
        oldest = entry
        oldestAge = age
      }
    }
    oldest?.markScheduled(frame)
  }

  /**
   * Call once per frame per light with `updated` true when the light was added or changed. Returns
   * the light's mobility factor. Lights are movable (stationary lights are treated as movable).
   */
  updateLightMobility(lightId: string, updated: boolean) {
    let m = this.mobility.get(lightId)
    if (!m) {
      m = { firstActiveFrame: -1, mobilityFactor: 0, active: false }
      this.mobility.set(lightId, m)
      updated = true // an added light is updated like a known one
    }
    if (updated) {
      m.firstActiveFrame = -1
      m.active = true
      m.mobilityFactor = 1
    }
    if (m.active) {
      const frame = this.frameStamp | 0
      if (m.firstActiveFrame === -1) {
        m.firstActiveFrame = frame
        m.mobilityFactor = 1
      } else if (frame - m.firstActiveFrame < VSM_LIGHT_ACTIVE_FRAME_COUNT) {
        m.mobilityFactor = Math.fround(
          1 - saturate((frame - m.firstActiveFrame) / VSM_LIGHT_ACTIVE_FRAME_COUNT),
        )
      } else {
        m.active = false
        m.mobilityFactor = 0
      }
    }
    return m.active ? m.mobilityFactor : 0
  }

  /** Forgets the mobility state of removed lights. */
  removeLightMobility(lightId: string) {
    this.mobility.delete(lightId)
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
    const maxPageAllocation = VSM_PRESSURE_LOAD,
      biasCap = VSM_PRESSURE_BIAS_MAX
    const f = Math.fround
    if (maxPageAllocation > 0) {
      const frameStamp = this.frameStamp >>> 0
      const currentAllocation = f(1 - f(freePages / this.poolPages))
      const allocationRatio = f(currentAllocation / f(maxPageAllocation))
      const targetBias = f(Math.max(0, lastPressureBias + Math.log2(allocationRatio)))
      if (
        currentAllocation <= f(maxPageAllocation) &&
        (frameStamp - this.lastFrameOverBudget) >>> 0 > VSM_PRESSURE_CALM_FRAMES
      ) {
        this.pressureBias = f(lerp(this.pressureBias, targetBias, VSM_PRESSURE_FALL))
      } else if (currentAllocation > f(maxPageAllocation)) {
        this.lastFrameOverBudget = frameStamp
        this.pressureBias = f(lerp(this.pressureBias, targetBias, VSM_PRESSURE_RISE))
      }
    }
    const bias = clamp(this.pressureBias, 0, biasCap)
    // In f32, nine tenths of k·2^-149 round back to it for k <= 4: the decay would stop there.
    this.pressureBias = bias < VSM_PRESSURE_BIAS_FLOOR ? 0 : bias
    return this.pressureBias
  }
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
  private readonly ring: VsmReadbackRing

  constructor(device: GPUDevice, cache: VsmCacheManager, maxInFlight = 3) {
    this.ring = createVsmReadbackRing(
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
