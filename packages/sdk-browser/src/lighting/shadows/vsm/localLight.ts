import { LIGHT_KIND } from '../../../../../sdk-core/src/scene/light/contracts.ts'
import {
  VSM_MIPS,
  VSM_MAP_COARSE,
  VSM_MAP_COARSE_KEEPS_DYNAMIC,
  VSM_MAP_DISTANT,
  VSM_MAP_UNCACHED,
  VSM_MAP_COVERAGE,
  VSM_LEVEL0_TEXELS,
  vsmLocalMipLevel,
} from './constants.ts'
import { vsmShadowMatrices } from './projection/projectionData.ts'
import {
  VSM_DEFAULT_MAPS,
  vsmLightPose,
  vsmMobilityAt,
  vsmLocalBias,
  type VsmMapSettings,
} from './mapSettings.ts'
import { vsmMapsOf } from './mapViews.ts'
import {
  cubeFaceProjection,
  localWorldToLight,
  POINT_FACE_VIEWS,
  spotMapProjection,
} from './localFaces.ts'
import { vsmDistantOf } from './distantLights.ts'
import type { VsmCacheManager } from './cacheManager.ts'
import {
  LOCAL_SHAPE_AT,
  LOCAL_SHAPE_WORDS,
  type VsmLightCache,
  type VsmLocalShape,
} from './lightCache.ts'
import { VSM_LIGHT_SHADOW, type VsmCameraInput, type VsmViewport } from './clipmap.ts'
import { transformPointRow } from '../../../../../math/src/vector/vector.ts'

/** What every local light's setup reads (metres, world). */
interface VsmLocalLightCommon {
  /** Scene light id (of the cache key). */
  id: string
  /** World position, double. */
  position: ArrayLike<number>
  /** Attenuation radius. */
  range: number
  /** The radius, metres, of a point or spot's source (`emitterRadius`); default 0, a rectangle's too. */
  sourceRadius?: number
  /** The soft radius and the length of the source (`emitterSoftRadius`, `emitterLength`): default 0.
   *  The maps are cut by neither, and a change of either remakes the light's entry all the same. */
  softSourceRadius?: number
  sourceLength?: number
  /** Whether the light is `movable`: only a movable light takes the moving bias (`vsmMobilityAt`);
   *  a static or stationary light never moves, so its maps rest at the still bias from its first frame. */
  movable?: boolean
}

/** A point light, a spot or a rectangle as the setup reads it: each kind holds what its maps are
 *  cut by — a spot its axis and the outer cone its map is as wide as (`spotConesOf`, the one it is
 *  lit by), a rectangle its face normal and its unit width axis perpendicular to it. */
export type VsmLocalLightInput =
  | (VsmLocalLightCommon & { kind: 'point' })
  | (VsmLocalLightCommon & {
      kind: 'spot'
      /** The spot's axis. */
      direction: ArrayLike<number>
      /** The outer cone half-angle, radians. */
      outerCone: number
      /** The inner cone half-angle, radians, as declared; default 0. The map is not cut by it. */
      innerCone?: number
    })
  | (VsmLocalLightCommon & {
      kind: 'rect'
      direction: ArrayLike<number>
      right: ArrayLike<number>
    })

/** The data of one map view. */
interface VsmLocalViewData {
  /** World → view, column-major, looking down −Z. */
  view: ArrayLike<number>
  clipToSizeScale: number
  clipToSizeBias: number
}

/** The per-view footprint factors, from our projection (w = −p[11]·depth + p[15]). */
export function vsmLocalViewData(camera: VsmCameraInput, viewport: VsmViewport): VsmLocalViewData {
  const p = camera.projection
  const radiusX = Math.fround(Math.fround(2 / viewport.width) / Math.fround(p[0])),
    radiusY = Math.fround(Math.fround(2 / viewport.height) / Math.fround(p[5]))
  const minRadiusClip = Math.min(radiusX, radiusY)
  return {
    view: camera.view,
    clipToSizeScale: Math.fround(-p[11] * minRadiusClip),
    clipToSizeBias: Math.fround(p[15] * minRadiusClip),
  }
}

/** What a local light's frame set up: kept by its cache entry, rewritten each frame. */
export interface VsmLocalLightSetup {
  cacheEntry: VsmLightCache
  finestMip: number
}

/** The conservative mip level of a local light. */
function coarsestMipNeeded(
  view: VsmLocalViewData,
  lightOrigin: ArrayLike<number>,
  lightRange: number,
  footprintPerDistance: number,
  levelBias: number,
  pressureBias: number,
  mipMode: number,
) {
  const v = view.view
  // The light's depth is along +Z of its view; the engine's camera looks down −Z.
  const depth = -transformPointRow(v, 2, lightOrigin[0], lightOrigin[1], lightOrigin[2])
  const worldRadius = Math.fround(
    Math.fround(Math.max(0, Math.fround(depth) - lightRange)) * view.clipToSizeScale +
      view.clipToSizeBias,
  )
  const shadowFootprint = Math.fround((worldRadius * footprintPerDistance) / lightRange)
  return vsmLocalMipLevel(shadowFootprint, levelBias, pressureBias, 0, mipMode)
}

/** The finest mip level any of `views` needs of the light, conservatively. */
function finestMipNeeded(
  views: readonly VsmLocalViewData[],
  origin: ArrayLike<number>,
  radius: number,
  projectionScale: number,
  levelBias: number,
  cache: VsmCacheManager,
  mipMode: number,
) {
  const footprintPerDistance = Math.fround(Math.fround(projectionScale) * VSM_LEVEL0_TEXELS)
  let finestMip = VSM_MIPS
  for (const view of views) {
    const needed = coarsestMipNeeded(
      view,
      origin,
      radius,
      footprintPerDistance,
      levelBias,
      cache.pressureBias,
      mipMode,
    )
    finestMip = Math.min(finestMip, needed)
  }
  return finestMip
}

// The frame's scratch: what a light computes before its cache entry is known (the light's record
// copies its pose when it changes), and its maps' rendering matrices, copied into each map's own record.
const direction: [number, number, number] = [0, 0, 0],
  spotView = new Float64Array(16),
  viewToClip = new Float64Array(16)

/** The pose a light's record compares (`vsmLightPose`): the rotation, the position and the shape, one
 *  array the scratch below are slices of. */
const pose = new Float64Array(16 + 3 + LOCAL_SHAPE_WORDS)
const worldToLight = pose.subarray(0, 16),
  preShadow = pose.subarray(16, 19),
  shape: VsmLocalShape = pose.subarray(19)

/** The light's rotation and its maps' projection into the scratch, and the outer cone of a spot's
 *  map (0 for the cube of a point light or a rectangle). */
function localProjection(light: VsmLocalLightInput) {
  localWorldToLight(worldToLight, direction, light)
  if (light.kind !== 'spot') {
    cubeFaceProjection(viewToClip, light.range)
    return 0
  }
  spotMapProjection(spotView, viewToClip, worldToLight, direction, light.range, light.outerCone)
  return light.outerCone
}

/** The flags of a local light's maps: uncached, covered, its last mip's page marked unless the view
 *  turns local coarse pages off (mode 0) — a distant light's always — and, in mode 2, kept with its
 *  dynamic layer cached. */
function localFlags(entry: VsmLightCache, marks: number, distant: boolean) {
  let flags = entry.isUncached ? VSM_MAP_UNCACHED : 0
  flags |= entry.useCover ? VSM_MAP_COVERAGE : 0
  flags |= marks === 0 && !distant ? 0 : VSM_MAP_COARSE
  flags |= distant ? VSM_MAP_DISTANT : 0
  return flags | (marks === 2 ? VSM_MAP_COARSE_KEEPS_DYNAMIC : 0)
}

/** What a light writes into each of its maps' records, beside the matrices. */
interface MapFields {
  radius: number
  levelBias: number
  flags: number
  finestMip: number
}

/** The fields of the light being set up, rewritten by each. */
const mapFields: MapFields = { radius: 0, levelBias: 0, flags: 0, finestMip: 0 }

/** Each map's record of a light: its projection matrices, rewritten only when something
 *  invalidated the light, then the fields of the light. */
function writeMapRecords(entry: VsmLightCache, light: VsmLocalLightInput, fields: MapFields) {
  const updateMatrices = entry.isInvalidated()
  for (let index = 0; index < entry.mapCaches.length; index++) {
    const map = entry.mapCaches[index]
    map.update(entry)
    const data = map.projectionData
    if (updateMatrices) {
      // The local light's projection matrices.
      const shiftedToView = light.kind === 'spot' ? spotView : POINT_FACE_VIEWS[index]
      data.lightViewToClip.set(viewToClip)
      vsmShadowMatrices(data, shiftedToView, viewToClip)
      for (let k = 0; k < 3; k++) {
        data.originShift[k] = preShadow[k]
        data.lightDirection[k] = 0
      }
      data.mapLevel = 0
      data.levelsLeft = -1
    }
    data.lightKind = LIGHT_KIND[light.kind]
    data.emitterSize = light.sourceRadius ?? 0
    data.lightRange = fields.radius
    data.ditherTexels = VSM_LIGHT_SHADOW.ditherTexels
    data.levelBias = fields.levelBias
    data.flags = fields.flags
    data.finestMip = fields.finestMip
  }
}

/** The light's shape words: its kind, range, cones and source. */
function writeLocalShape(light: VsmLocalLightInput, radius: number, outerCone: number) {
  shape[LOCAL_SHAPE_AT.type] = light.kind === 'spot' ? 1 : 0
  shape[LOCAL_SHAPE_AT.range] = radius
  shape[LOCAL_SHAPE_AT.outerCone] = outerCone
  shape[LOCAL_SHAPE_AT.innerCone] = light.kind === 'spot' ? (light.innerCone ?? 0) : 0
  shape[LOCAL_SHAPE_AT.sourceRadius] = light.sourceRadius ?? 0
  shape[LOCAL_SHAPE_AT.softSourceRadius] = light.softSourceRadius ?? 0
  shape[LOCAL_SHAPE_AT.sourceLength] = light.sourceLength ?? 0
}

/**
 * Sets up a local light's shadow: finds/updates the light's cache entry, computes the finest mip level, and
 * refreshes the cached projection data of each of its maps. The setup returned is the one the
 * entry keeps (`VsmLightCache.localSetup`): the next frame of the same light rewrites it. Its
 * resolution bias and its coarse pages are the settings' (`maps`); a distant light
 * (`vsmDistantOf`) takes the last mip alone, and is drawn again only on its turn
 * (`scheduleDistantUpdates`) or where its key changed.
 */
export function addVsmLocalLightShadow(
  cache: VsmCacheManager,
  light: VsmLocalLightInput,
  views: readonly VsmLocalViewData[],
  maps: VsmMapSettings = VSM_DEFAULT_MAPS,
): VsmLocalLightSetup {
  const radius = light.range
  const origin = light.position
  for (let k = 0; k < 3; k++) preShadow[k] = -origin[k]
  const outerCone = localProjection(light)
  const numMaps = vsmMapsOf(light.kind)
  const cacheEntry = cache.lightEntryFor(light.id, numMaps)

  writeLocalShape(light, radius, outerCone)
  // The light's bias: the view's, coarser while the light moves (`vsmMobilityAt`), its own added.
  const { shadows } = maps
  const frame = maps.frame
  // Moving: the light's pose or shape changed since it was last asked, as an updated light is
  // marked moving, whether or not its cache entry stood in between. The same ask says whether the
  // entry's pages are stale.
  const move = vsmLightPose(cache.lightMoves, light.id, pose, frame)
  const mobility = light.movable
    ? vsmMobilityAt(move, frame, shadows.shadowLightActiveFrameCount)
    : 0
  const localLevelBias = vsmLocalBias(shadows, mobility, VSM_LIGHT_SHADOW.levelBias)
  const needed = finestMipNeeded(
    views,
    origin,
    radius,
    viewToClip[0],
    localLevelBias,
    cache,
    shadows.shadowMarkPixelPagesMipModeLocal,
  )
  const distant = vsmDistantOf(shadows.shadowDistantLightMode, needed)
  const finestMip = distant ? VSM_MIPS - 1 : needed
  // Drawn uncached each frame: with the cache off, or as `shadowForceInvalidateLocal` names the light
  // (1 the lights that are not distant, 2 all of them).
  const forced = shadows.shadowForceInvalidateLocal
  const uncached = !cache.cacheEnabled || forced === 2 || (forced === 1 && !distant)
  cacheEntry.updateLocal(
    move.movedAt === frame,
    distant,
    uncached,
    shadows.shadowUseReceiverMaskLocal,
  )
  // Its turn in the schedule: drawn again, its pages not carried (`VsmMapCache.update`).
  if (distant && cacheEntry.scheduledFrame === frame) cacheEntry.invalidate()

  const flags = localFlags(cacheEntry, shadows.shadowMarkCoarsePagesLocal, distant)
  mapFields.radius = radius
  mapFields.levelBias = localLevelBias
  mapFields.flags = flags
  mapFields.finestMip = finestMip
  writeMapRecords(cacheEntry, light, mapFields)

  const setup = (cacheEntry.localSetup ??= { cacheEntry, finestMip })
  setup.finestMip = finestMip
  return setup
}
