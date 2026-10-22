import { LIGHT_KIND } from '../../../../../sdk-core/src/scene/light/contracts.ts'
import {
  VSM_LOCAL_NEAR_PLANE,
  VSM_MIPS,
  VSM_MAP_COARSE,
  VSM_MAP_COARSE_KEEPS_DYNAMIC,
  VSM_MAP_UNCACHED,
  VSM_MAP_COVERAGE,
  VSM_UNIT_PER_CM,
  VSM_LEVEL0_TEXELS,
  vsmLocalMipLevel,
} from './constants.ts'
import { vsmShadowMatrices } from './projection/projectionData.ts'
import {
  VSM_DEFAULT_MAPS,
  vsmLightMobility,
  vsmLocalBias,
  type VsmMapSettings,
} from './mapSettings.ts'
import { vsmMapsOf } from './mapViews.ts'
import { clampedOuterConeAngle, POINT_FACE_VIEWS } from './localFaces.ts'
import { multiplyMatrix4 } from '../../../../../math/src/matrix/matrix4.ts'
import type { VsmCacheManager, VsmLightCache } from './cacheManager.ts'
import {
  VSM_FACE_MATRIX,
  VSM_MIN_DIRECTION_SQ,
  vsmWorldToLightRotation,
  type VsmCameraInput,
  type VsmViewport,
} from './clipmap.ts'
import { QUARTER_PI } from '../../../../../math/src/constants.ts'
import { focalScale } from '../../../../../math/src/projection/camera.ts'
import { forwardPerspectiveProjection } from '../../../../../math/src/projection/forwardZ.ts'
import {
  normalizeVector3OrZero,
  transformAffinePoint,
  transformPointRow,
} from '../../../../../math/src/vector/vector.ts'

/** The nearest depth a local light's casters take: 0.1 cm. */
const VSM_LOCAL_MIN_LIGHT_W = 0.1 * VSM_UNIT_PER_CM

/** A point or spot light as the setup reads it (metres, world). */
export interface VsmLocalLightInput {
  /** Scene light id (of the cache key). */
  id: string
  kind: 'point' | 'spot'
  /** World position, double. */
  position: ArrayLike<number>
  /** Spot axis. */
  direction?: ArrayLike<number>
  /** Attenuation radius. */
  range: number
  /** Spot outer cone half-angle, radians. */
  coneAngle?: number
  /** Spot inner cone half-angle, radians (default 0). */
  innerConeAngle?: number
  /** Source radius (point/spot), metres; default 0. */
  sourceRadius?: number
  levelBias?: number
  ditherTexels?: number
}

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
) {
  const v = view.view
  // The light's depth is along +Z of its view; the engine's camera looks down −Z.
  const depth = -transformPointRow(v, 2, lightOrigin[0], lightOrigin[1], lightOrigin[2])
  const worldRadius = Math.fround(
    Math.fround(Math.max(0, Math.fround(depth) - lightRange)) * view.clipToSizeScale +
      view.clipToSizeBias,
  )
  const shadowFootprint = Math.fround((worldRadius * footprintPerDistance) / lightRange)
  return vsmLocalMipLevel(shadowFootprint, levelBias, pressureBias)
}

/** The finest mip level any of `views` needs of the light, conservatively. */
function finestMipNeeded(
  views: readonly VsmLocalViewData[],
  origin: ArrayLike<number>,
  radius: number,
  projectionScale: number,
  levelBias: number,
  cache: VsmCacheManager,
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
    )
    finestMip = Math.min(finestMip, needed)
  }
  return finestMip
}

// The frame's scratch: what a light computes before its cache entry is known (the entry copies
// its key when it changes), and its maps' rendering matrices, copied into each map's own record.
const X_AXIS = [1, 0, 0],
  direction: [number, number, number] = [0, 0, 0],
  preShadow: [number, number, number] = [0, 0, 0],
  shape: [number, number, number] = [0, 0, 0],
  worldToLight = new Float64Array(16),
  localKey = { worldToLight, lightOriginShift: preShadow, shape },
  spotView = new Float64Array(16),
  spotCentre = new Float64Array(3),
  viewToClip = new Float64Array(16)

/**
 * Sets up a local light's shadow: finds/updates the light's cache entry, computes the finest mip level, and
 * refreshes the cached projection data of each of its maps. The setup returned is the one the
 * entry keeps (`VsmLightCache.localSetup`): the next frame of the same light rewrites it. Its
 * resolution bias and its coarse pages are the settings' (`maps`).
 */
export function addVsmLocalLightShadow(
  cache: VsmCacheManager,
  light: VsmLocalLightInput,
  views: readonly VsmLocalViewData[],
  maps: VsmMapSettings = VSM_DEFAULT_MAPS,
): VsmLocalLightSetup {
  const isSpot = light.kind === 'spot'
  const radius = light.range
  const origin = light.position
  for (let k = 0; k < 3; k++) preShadow[k] = -origin[k]

  // Light rotation (the world-to-light rotation, no translation): a spot's X axis is its direction; a
  // point light's faces are world-aligned and its rotation is the identity.
  if (isSpot) normalizeVector3OrZero(direction, light.direction ?? X_AXIS, VSM_MIN_DIRECTION_SQ)
  else {
    direction[0] = 1
    direction[1] = direction[2] = 0
  }
  vsmWorldToLightRotation(worldToLight, direction)

  // Shadow projections (metres): the spot's map, or the six cube faces
  // of one projection (`POINT_FACE_VIEWS`).
  let outerCone = 0
  if (isSpot) {
    outerCone = clampedOuterConeAngle(light.innerConeAngle ?? 0, light.coneAngle ?? QUARTER_PI)
    const cosOuter = Math.fround(Math.cos(outerCone)),
      sinOuter = Math.fround(Math.sin(outerCone)),
      invTanOuter = Math.fround(focalScale(outerCone))
    // The bounding sphere of the cone, relative to the light: past a half angle of 45° (cos² = 1/2)
    // the sphere through the cap's rim, its centre on the axis at the rim's foot; below, the
    // sphere through the light and the rim.
    let sphereOffset: number, sphereRadius: number
    if (cosOuter < Math.fround(Math.SQRT1_2)) {
      sphereOffset = radius * cosOuter
      sphereRadius = radius * sinOuter
    } else {
      sphereRadius = radius / (2 * cosOuter)
      sphereOffset = sphereRadius
    }
    multiplyMatrix4(spotView, VSM_FACE_MATRIX, worldToLight)
    const c = transformAffinePoint(
      spotCentre,
      spotView,
      direction[0] * sphereOffset,
      direction[1] * sphereOffset,
      direction[2] * sphereOffset,
    )
    let depthFar = Math.fround(c[2] + sphereRadius)
    const depthNear = Math.fround(Math.max(depthFar - sphereRadius * 2, VSM_LOCAL_MIN_LIGHT_W))
    depthFar = Math.fround(Math.min(depthFar, radius))
    // The outer scale (no border at 16384²), between the nearest and farthest caster depths.
    forwardPerspectiveProjection(viewToClip, invTanOuter, depthNear, depthFar)
  } else
    forwardPerspectiveProjection(
      viewToClip,
      focalScale(Math.fround(QUARTER_PI)),
      VSM_LOCAL_NEAR_PLANE,
      radius,
    )
  const projectionScale = viewToClip[0]

  const numMaps = vsmMapsOf(light.kind)
  const cacheEntry = cache.lightEntryFor(light.id, numMaps)

  const forceInvalidate = !cache.cacheEnabled

  shape[0] = isSpot ? 1 : 0
  shape[1] = radius
  shape[2] = outerCone
  const moved = cacheEntry.updateLocal(localKey, forceInvalidate)

  // The light's bias: the view's, coarser while the light moves (`vsmLightMobility`), its own added.
  const { shadows } = maps
  const frame = maps.frame ?? cache.frameStamp
  const mobility = vsmLightMobility(cacheEntry, moved, frame, shadows.shadowLightActiveFrameCount)
  const localLevelBias = vsmLocalBias(shadows, mobility, light.levelBias ?? 0)
  const finestMip = finestMipNeeded(views, origin, radius, projectionScale, localLevelBias, cache)

  let flags = cacheEntry.isUncached ? VSM_MAP_UNCACHED : 0
  flags |= cacheEntry.useCover ? VSM_MAP_COVERAGE : 0
  // The last mip's page is marked unless the view turns local coarse pages off (mode 0); in mode 2
  // it keeps its dynamic layer cached.
  const marks = shadows.shadowMarkCoarsePagesLocal
  flags |= marks === 0 ? 0 : VSM_MAP_COARSE
  flags |= marks === 2 ? VSM_MAP_COARSE_KEEPS_DYNAMIC : 0

  // Matrices only change when something invalidated the light rewritten then
  // alone, into each map's own record.
  const updateMatrices = cacheEntry.isInvalidated()
  for (let index = 0; index < numMaps; index++) {
    const entry = cacheEntry.mapCaches[index]
    entry.update(cacheEntry)
    const data = entry.projectionData
    if (updateMatrices) {
      // The local light's projection matrices.
      const shiftedToView = isSpot ? spotView : POINT_FACE_VIEWS[index]
      data.lightViewToClip.set(viewToClip)
      vsmShadowMatrices(data, shiftedToView, viewToClip)
      for (let k = 0; k < 3; k++) {
        data.originShift[k] = preShadow[k]
        data.lightDirection[k] = 0
      }
      data.mapLevel = 0
      data.levelsLeft = -1
    }
    data.lightKind = isSpot ? LIGHT_KIND.spot : LIGHT_KIND.point
    data.emitterSize = light.sourceRadius ?? 0
    data.lightRange = radius
    data.ditherTexels = light.ditherTexels ?? 1
    data.levelBias = localLevelBias
    data.flags = flags
    data.finestMip = finestMip
  }

  const setup = (cacheEntry.localSetup ??= { cacheEntry, finestMip })
  setup.finestMip = finestMip
  return setup
}
