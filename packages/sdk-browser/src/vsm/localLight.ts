import {
  VSM_LIGHT_KIND_POINT,
  VSM_LIGHT_KIND_SPOT,
  VSM_LOCAL_NEAR_PLANE,
  VSM_MIPS,
  VSM_MAP_COARSE_KEEPS_DYNAMIC,
  VSM_MAP_UNCACHED,
  VSM_MAP_COVERAGE,
  VSM_LOCAL_LEVEL_BIAS,
  VSM_LOCAL_LEVEL_BIAS_MOVING,
  VSM_UNIT_PER_CM,
  VSM_COVER_LOCAL,
  VSM_LEVEL0_TEXELS,
  vsmLocalMipLevel,
  vsmMovingBias,
} from './constants.ts'
import { vsmShadowUvMatrix, vsmShadowUvNormalMatrix } from './projectionData.ts'
import { cross } from '../../../sdk-core/src/math/primitives/vectorTuple.ts'
import { multiplyMatrix4 } from '../../../sdk-core/src/math/matrix/matrix4.ts'
import type { VsmCacheManager, VsmLightCache } from './cacheManager.ts'
import {
  VSM_FACE_MATRIX,
  vsmNormalizeOrZero,
  vsmTransformPoint,
  vsmWorldToLightRotation,
  type VsmCameraInput,
  type VsmViewport,
} from './clipmap.ts'

/** The nearest depth a local light's casters take: 0.1 cm. */
const VSM_LOCAL_MIN_LIGHT_W = 0.1 * VSM_UNIT_PER_CM

const f32 = Math.fround

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
  const radiusX = f32(f32(2 / viewport.width) / f32(p[0])),
    radiusY = f32(f32(2 / viewport.height) / f32(p[5]))
  const minRadiusClip = Math.min(radiusX, radiusY)
  return {
    view: camera.view,
    clipToSizeScale: f32(-p[11] * minRadiusClip),
    clipToSizeBias: f32(p[15] * minRadiusClip),
  }
}

/** What a local light's frame set up: kept by its cache entry, rewritten each frame. */
export interface VsmLocalLightSetup {
  cacheEntry: VsmLightCache
  finestMip: number
  /** Whether the light renders a virtual shadow map. */
  drawsThisFrame: boolean
}

/** Declared: the widest half angle a spot's one perspective map takes, 88.9°: its 1 / tan, the
 *  map's scale, is 0.019 there and falls to 0 at 90°, where the map's texels stretch without bound. */
const MAX_SPOT_HALF_ANGLE = (88.9 * Math.PI) / 180
/** Declared: the least gap of the outer cone over the inner one, 0.001 rad. */
const SPOT_CONE_GAP = 0.001

/** The outer half angle of a spot's map, radians: at least the inner one (itself within [0, the
 *  widest]) plus the gap, at most the widest plus the gap; rounded once, to an f32. */
function clampedOuterConeAngle(innerRad: number, outerRad: number) {
  const inner = Math.min(Math.max(innerRad, 0), MAX_SPOT_HALF_ANGLE)
  return f32(
    Math.min(Math.max(outerRad, inner + SPOT_CONE_GAP), MAX_SPOT_HALF_ANGLE + SPOT_CONE_GAP),
  )
}

/** The shadow projection matrix of the nearest and farthest caster depths, its w the view depth. */
function shadowProjectionMatrix(out: Float64Array, minZ: number, maxZ: number) {
  out.fill(0)
  out[0] = 1
  out[5] = 1
  out[10] = -minZ / (maxZ - minZ)
  out[11] = 1
  out[14] = (maxZ * minZ) / (maxZ - minZ)
  return out
}

/** The square reversed-Z perspective matrix of a half field of view and a depth range (near, far). */
function reversedZPerspectiveMatrix(
  out: Float64Array,
  halfFov: number,
  minZ: number,
  maxZ: number,
) {
  out.fill(0)
  const t = Math.tan(halfFov)
  out[0] = out[5] = 1 / t
  out[10] = minZ === maxZ ? 0 : minZ / (minZ - maxZ)
  out[11] = 1
  out[14] = minZ === maxZ ? minZ : (-maxZ * minZ) / (minZ - maxZ)
  return out
}

/** The cube face directions and up vectors. */
const CUBE_DIRECTIONS: [number, number, number][] = [
  [-1, 0, 0],
  [1, 0, 0],
  [0, -1, 0],
  [0, 1, 0],
  [0, 0, -1],
  [0, 0, 1],
]
const UP_VECTORS: [number, number, number][] = [
  [0, 1, 0],
  [0, 1, 0],
  [0, 0, -1],
  [0, 0, 1],
  [0, 1, 0],
  [0, 1, 0],
]
/**
 * Face i's view rotation, a look-from matrix of (Dir_i, Up_i) scaled by (1,-1,1) then (1,1,-1)
 * (light position removed: the face matrices are relative to the light). The
 * same six for every point light (`POINT_FACE_VIEWS`).
 */
function pointFaceView(face: number) {
  const z = vsmNormalizeOrZero(CUBE_DIRECTIONS[face])
  const x = vsmNormalizeOrZero(cross(UP_VECTORS[face], z))
  const y = cross(z, x)
  const m = new Float64Array(16)
  for (let r = 0; r < 3; r++) {
    m[r * 4 + 0] = x[r]
    m[r * 4 + 1] = -y[r]
    m[r * 4 + 2] = -z[r]
  }
  m[15] = 1
  return m
}
const POINT_FACE_VIEWS = Array.from({ length: 6 }, (_, face) => pointFaceView(face))

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
  const depth = -(v[2] * lightOrigin[0] + v[6] * lightOrigin[1] + v[10] * lightOrigin[2] + v[14])
  const worldRadius = f32(
    f32(Math.max(0, f32(depth) - lightRange)) * view.clipToSizeScale + view.clipToSizeBias,
  )
  const shadowFootprint = f32((worldRadius * footprintPerDistance) / lightRange)
  return vsmLocalMipLevel(shadowFootprint, levelBias, pressureBias)
}

/** The setup each light's cache entry keeps (`addVsmLocalLightShadow`), rewritten each frame. */
const SETUPS = new WeakMap<VsmLightCache, VsmLocalLightSetup>()
// The frame's scratch: what a light computes before its cache entry is known (the entry copies
// its key when it changes), and its maps' rendering matrices, copied into each map's own record.
const X_AXIS = [1, 0, 0],
  direction: [number, number, number] = [0, 0, 0],
  preShadow: [number, number, number] = [0, 0, 0],
  lightOrigin: [number, number, number] = [0, 0, 0],
  shape: [number, number, number] = [0, 0, 0],
  worldToLight = new Float64Array(16),
  localKey = { worldToLight, lightOriginShift: preShadow, isCachedFarLight: false, shape },
  spotView = new Float64Array(16),
  spotCentre = new Float64Array(3),
  viewToClip = new Float64Array(16)

/**
 * Sets up a local light's shadow: finds/updates the light's cache entry, computes the finest mip level and the distant-light state, and
 * refreshes the cached projection data of each of its maps. The setup returned is the one the
 * entry keeps (`SETUPS`): the next frame of the same light rewrites it.
 */
export function addVsmLocalLightShadow(
  cache: VsmCacheManager,
  light: VsmLocalLightInput,
  views: readonly VsmLocalViewData[],
  movingShare: number,
): VsmLocalLightSetup {
  const isSpot = light.kind === 'spot'
  const radius = light.range
  const origin = light.position
  for (let k = 0; k < 3; k++) {
    preShadow[k] = -origin[k]
    lightOrigin[k] = origin[k]
  }
  const localLevelBias = f32(
    vsmMovingBias(VSM_LOCAL_LEVEL_BIAS, VSM_LOCAL_LEVEL_BIAS_MOVING, movingShare) +
      (light.levelBias ?? 0),
  )

  // Light rotation (the world-to-light rotation, no translation): a spot's X axis is its direction; a
  // point light's faces are world-aligned and its rotation is the identity.
  if (isSpot) vsmNormalizeOrZero(light.direction ?? X_AXIS, direction)
  else {
    direction[0] = 1
    direction[1] = direction[2] = 0
  }
  vsmWorldToLightRotation(worldToLight, direction)

  // Shadow projections (metres): the spot's map, or the six cube faces
  // of one projection (`POINT_FACE_VIEWS`).
  let outerCone = 0
  if (isSpot) {
    outerCone = clampedOuterConeAngle(light.innerConeAngle ?? 0, light.coneAngle ?? Math.PI / 4)
    const cosOuter = f32(Math.cos(outerCone)),
      sinOuter = f32(Math.sin(outerCone)),
      invTanOuter = f32(1 / Math.tan(outerCone))
    // The bounding sphere of the cone, relative to the light: past a half angle of 45° (cos² = 1/2)
    // the sphere through the cap's rim, its centre on the axis at the rim's foot; below, the
    // sphere through the light and the rim.
    let sphereOffset: number, sphereRadius: number
    if (cosOuter < f32(Math.SQRT1_2)) {
      sphereOffset = radius * cosOuter
      sphereRadius = radius * sinOuter
    } else {
      sphereRadius = radius / (2 * cosOuter)
      sphereOffset = sphereRadius
    }
    multiplyMatrix4(spotView, VSM_FACE_MATRIX, worldToLight)
    const c = vsmTransformPoint(
      spotView,
      direction[0] * sphereOffset,
      direction[1] * sphereOffset,
      direction[2] * sphereOffset,
      spotCentre,
    )
    let depthFar = f32(c[2] + sphereRadius)
    const depthNear = f32(Math.max(depthFar - sphereRadius * 2, VSM_LOCAL_MIN_LIGHT_W))
    depthFar = f32(Math.min(depthFar, radius))
    // The outer scale (no border at 16384²) · the shadow projection matrix.
    shadowProjectionMatrix(viewToClip, depthNear, depthFar)
    viewToClip[0] = invTanOuter
    viewToClip[5] = invTanOuter
  } else reversedZPerspectiveMatrix(viewToClip, f32(Math.PI / 4), VSM_LOCAL_NEAR_PLANE, radius)
  const projectionScale = viewToClip[0]

  // The finest mip level any view needs, conservatively.
  const footprintPerDistance = f32(f32(projectionScale) * VSM_LEVEL0_TEXELS)
  let finestMip = VSM_MIPS
  for (let v = 0; v < views.length; v++)
    finestMip = Math.min(
      finestMip,
      coarsestMipNeeded(
        views[v],
        origin,
        radius,
        footprintPerDistance,
        localLevelBias,
        cache.pressureBias,
      ),
    )

  const isCachedFarLight = finestMip === VSM_MIPS - 1

  const numMaps = isSpot ? 1 : 6
  const cacheEntry = cache.lightEntryFor(light.id, numMaps)

  const forceInvalidate = !cache.cacheEnabled

  localKey.isCachedFarLight = isCachedFarLight
  shape[0] = isSpot ? 1 : 0
  shape[1] = radius
  shape[2] = outerCone
  cacheEntry.updateLocal(localKey, lightOrigin, radius, forceInvalidate, VSM_COVER_LOCAL)
  if (isCachedFarLight && cacheEntry.scheduledFrame === (cache.frameStamp | 0))
    cacheEntry.invalidate()

  const drawsThisFrame = !cacheEntry.isFullyCached()

  let flags = cacheEntry.isUncached ? VSM_MAP_UNCACHED : 0
  flags |= cacheEntry.useCover ? VSM_MAP_COVERAGE : 0
  flags |= VSM_MAP_COARSE_KEEPS_DYNAMIC

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
      vsmShadowUvMatrix(data.shiftedToMapUv, shiftedToView, viewToClip)
      vsmShadowUvNormalMatrix(data.planesToMapUv, shiftedToView, viewToClip)
      for (let k = 0; k < 3; k++) {
        data.originShift[k] = preShadow[k]
        data.lightDirection[k] = 0
      }
      data.mapLevel = 0
      data.levelsLeft = -1
    }
    data.lightKind = isSpot ? VSM_LIGHT_KIND_SPOT : VSM_LIGHT_KIND_POINT
    data.emitterSize = light.sourceRadius ?? 0
    data.lightRange = radius
    data.ditherTexels = light.ditherTexels ?? 1
    data.levelBias = localLevelBias
    data.flags = flags
    data.finestMip = finestMip
  }

  let setup = SETUPS.get(cacheEntry)
  if (!setup) SETUPS.set(cacheEntry, (setup = { cacheEntry, finestMip, drawsThisFrame }))
  setup.finestMip = finestMip
  setup.drawsThisFrame = drawsThisFrame
  return setup
}
