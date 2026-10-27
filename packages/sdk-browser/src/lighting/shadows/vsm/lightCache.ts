/**
 * THE SHADOW MAPS' CACHE ENTRIES, CPU SIDE (`cacheManager.ts` holds them): one entry a light — a
 * sun's clipmap, centred on the eye, one per view, a local light's maps, which every view shares —,
 * each with one entry per shadow map (clipmap levels, 6 cube faces or 1 spot map) carrying the
 * cached projection data, the clipmap panning / depth range state and the next-map data the page
 * management uses to carry pages from the previous frame's ids to this frame's.
 *
 * Units: the clipmap's depth state (`depthCentre`, `depthRadius`) is kept in centimetres, the units
 * of the clipmap's level arithmetic (`clipmap.ts`); the projection data handed to the GPU is in
 * metres (see `clipmap.ts`).
 */
import { VSM_SUN_DEPTH_KEEP, VSM_NEXT_KEEPS_PAGES } from './constants.ts'
import { copyInto, sameValues } from '../../../../../math/src/matrix/matrixElements.ts'
import {
  vsmDefaultProjectionData,
  type VsmProjectionDataValues,
} from './projection/projectionData.ts'
import type { VsmClipmap } from './clipmap.ts'
import type { VsmLocalLightSetup } from './localLight.ts'
import { moveOcclusionView, occlusionViewOf } from './occlusion/occlusionView.ts'

/** The next-frame map data, 16 bytes on the GPU (`VsmNextMap`). */
export interface VsmNextMap {
  flags: number
  nextMapId: number
  pageShift: [number, number]
}

/** A clipmap level's cache state, centimetres. */
interface VsmLevelCache {
  levelPageOrigin: [number, number]
  depthCentre: number
  depthRadius: number
  /** The level's world-position-offset threshold (metres squared) when its pages were last drawn
   *  afresh. */
  wpoThreshold: number
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
    wpoThreshold: 0,
  }
  /** The view the occlusion pyramid last held the map by, and the one before
   *  (`occlusion/occlusionView.ts`). */
  occlusionView = { current: occlusionViewOf(), prev: occlusionViewOf() }

  /** Updates a clipmap level's cache state (centimetres): its pages are kept unless the light has
   *  not been drawn, the depth range changed or left its margin, or — `wpoInvalidates` — the level's
   *  world-position-offset threshold `wpoThreshold` is not the one its pages were drawn with. */
  updateLevel(
    perLight: VsmLightCache,
    levelPageOrigin: [number, number],
    levelRadius: number,
    depthCentre: number,
    depthRadius: number,
    wpoThreshold: number,
    wpoInvalidates: boolean,
  ) {
    moveOcclusionView(this.occlusionView)
    const c = this.clipmap
    let cacheValid = perLight.renderedFrame >= 0
    cacheValid = cacheValid && depthRadius === c.depthRadius
    if (cacheValid) {
      const deltaZ = Math.abs(depthCentre - c.depthCentre)
      if (deltaZ + levelRadius > VSM_SUN_DEPTH_KEEP * c.depthRadius) cacheValid = false
    }
    if (cacheValid && wpoInvalidates && wpoThreshold !== c.wpoThreshold) cacheValid = false
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
      c.wpoThreshold = wpoThreshold
    }
    c.levelPageOrigin[0] = levelPageOrigin[0]
    c.levelPageOrigin[1] = levelPageOrigin[1]
  }

  /** Update for local lights and inactive lights. */
  update(perLight: VsmLightCache) {
    moveOcclusionView(this.occlusionView)
    if (perLight.renderedFrame >= 0) {
      this.nextMaps.flags = VSM_NEXT_KEEPS_PAGES
      this.nextMaps.pageShift[0] = this.nextMaps.pageShift[1] = 0
    } else {
      this.nextMaps.flags = 0
    }
  }
}

/** A clipmap's cache key: a change invalidates. `shadow` is the light's own shadow settings, each
 *  a number, in the order of `LIGHT_SHADOW_FIELDS` but for `shadowAmount` (the distance, the cascades,
 *  the distance-field cascade's): a sun re-created by another of them has no cached page of the old one, whatever the
 *  edge, the view's scale or its switches make of it each frame. */
interface VsmSunCacheKey {
  lightDirection: [number, number, number]
  firstLevel: number
  shadow: number[]
}

/** What recreating a local light's proxy, hence its cache entry, keys by (`VsmLocalShape`): the word
 *  each is at — the light type (0 point, 1 spot), the range, the outer cone angle, the inner cone
 *  angle, the source radius, the soft source radius and the source length. */
export const LOCAL_SHAPE_AT = {
  type: 0,
  range: 1,
  outerCone: 2,
  innerCone: 3,
  sourceRadius: 4,
  softSourceRadius: 5,
  sourceLength: 6,
} as const
export type VsmLocalShape = Float64Array
/** The words of a local light's shape. */
export const LOCAL_SHAPE_WORDS = Object.keys(LOCAL_SHAPE_AT).length

/** The kind of shadow an entry holds: 0 the regular one, 1 a sun's first-person clipmap. */
export type VsmShadowType = 0 | 1

/** The key of an entry: the light's id, the view's (none: shared by every view) and the shadow
 *  type, as one JSON array, so that no id or view name can read as another's key. */
export const vsmCacheKey = (lightId: string, view?: string, typeTag: VsmShadowType = 0) =>
  JSON.stringify([lightId, view ?? null, typeTag])

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
  /** Whether the light was distant when it was last set up, none before: the part of a local light's
   *  key that is its entry's alone (its pose is the light's, `vsmLightPose`). */
  private wasDistant: boolean | undefined
  /** A sun's clipmap key of the last frame, rewritten in place when it changes. */
  private clipmapCacheKey: VsmSunCacheKey = {
    ...{ lightDirection: [NaN, NaN, NaN], firstLevel: 0, shadow: [NaN] },
  }
  /** A sun's clipmap (`buildVsmClipmap`), a local light's setup (`addVsmLocalLightShadow`): kept
   *  with the entry, rewritten in place every frame, made anew with a new entry. */
  clipmap?: VsmClipmap
  localSetup?: VsmLocalLightSetup
  /** The scene frame the distant lights' schedule last picked it for an update
   *  (`scheduleDistantUpdates`); -1 never. */
  scheduledFrame = -1

  readonly lightId: string
  /** The view it is drawn for: a sun's clipmap's (`''` the main view's); none for a local light's
   *  maps, which every view shares. */
  readonly view: string | undefined
  /** The kind of shadow it holds: 0 the regular one, 1 a sun's first-person clipmap. */
  readonly typeTag: VsmShadowType
  /** Its key in the cache's entries (`vsmCacheKey`). */
  readonly key: string

  constructor(lightId: string, mapCount: number, view?: string, typeTag: VsmShadowType = 0) {
    this.lightId = lightId
    this.view = view
    this.typeTag = typeTag
    this.key = vsmCacheKey(lightId, view, typeTag)
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
  /** Whether the light is distant (`vsmDistantOf`), as its key last said. */
  get distant() {
    return this.wasDistant === true
  }
  /** A distant light that was drawn: all its pages are mapped and drawn, and nothing but its turn
   *  in the schedule (`scheduleDistantUpdates`) or a change of its key draws them again. */
  isFullyCached() {
    return this.distant && this.renderedFrame >= 0
  }
  markScheduled(frame: number) {
    this.scheduledFrame = frame
  }
  /** The collector's filter: an entry that may hold cached pages to invalidate — neither fully
   *  cached, uncached nor invalidated, and given an id. */
  mayHoldCachedPages() {
    return !(this.isFullyCached() || this.isUncached || this.isInvalidated()) && this.mapId >= 0
  }
  moveToMapId(next: number) {
    this.prevMapId = this.mapId
    this.mapId = next
  }

  /** Invalidates the entry for a changed key, a forced invalidation or a cover turned on or off;
   *  a cached <-> uncached transition invalidates too. */
  private updateCommon(keyChanged: boolean, forceInvalidate: boolean, useCover: boolean) {
    if (forceInvalidate || keyChanged || useCover !== this.useCover) this.renderedFrame = -1
    this.useCover = useCover
    // An invalidated light renders the next frame uncached; uncached <-> cached transitions invalidate.
    const newIsUncached = this.renderedFrame < 0
    if (newIsUncached !== this.isUncached) {
      this.renderedFrame = -1
      this.isUncached = newIsUncached
    }
  }

  /** Updates a clipmap's cache entry: a changed key invalidates it. */
  updateClipmap(key: VsmSunCacheKey, forceInvalidate: boolean, useCover: boolean) {
    const k = this.clipmapCacheKey
    const changed =
      !sameValues(key.lightDirection, k.lightDirection) ||
      key.firstLevel !== k.firstLevel ||
      !sameValues(key.shadow, k.shadow)
    this.updateCommon(changed, forceInvalidate, useCover)
    if (changed) {
      copyInto(k.lightDirection, key.lightDirection)
      k.firstLevel = key.firstLevel
      copyInto(k.shadow, key.shadow)
    }
  }

  /** Updates a local light's cache entry, as a clipmap's: a moved light (`poseChanged`: its pose or its
   *  shape differs from the one it was last asked at, `vsmLightPose`) or a changed `distant` (whether
   *  the light is, `vsmDistantOf`) invalidates it. */
  updateLocal(poseChanged: boolean, distant: boolean, forceInvalidate: boolean, useCover: boolean) {
    this.updateCommon(poseChanged || distant !== this.wasDistant, forceInvalidate, useCover)
    this.wasDistant = distant
  }
}
