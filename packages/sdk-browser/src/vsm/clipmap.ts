/**
 * Directional light clipmap, with its cache rule.
 *
 * UNITS. The level arithmetic is in centimetres: a level's radius is 2^(level+1) cm, centres snap
 * on integer centimetres, and the depth range scale is a ratio of that radius. The module
 * computes in centimetres — the camera origin is converted on entry (×100) — and converts only
 * what leaves it: level centres and translations in metres, and the view-to-clip matrices rescaled
 * so they map the metre view space to the clip values the centimetre computation gives. Integer
 * outputs (corner offsets, page offsets) are unitless.
 *
 * MATRICES. The matrices are the engine's: column-major, column-vector (`m[column·4 + row]`).
 * `multiplyMatrix4(out, A, B)` is A·B, B applied first; `vsmTransformPoint` applies one to a point.
 */
import { copyMatrix4, multiplyMatrix4 } from '../../../math/src/matrix/matrix4.ts'
import {
  VSM_SUN_COARSE_FROM,
  VSM_SUN_FINEST_LEVEL,
  VSM_SUN_COARSE_TO,
  VSM_SUN_COARSEST_LEVEL,
  VSM_SUN_DEPTH_SPAN,
  VSM_CM_PER_UNIT,
  VSM_LEVEL0_PAGES,
  VSM_LIGHT_KIND_DIRECTIONAL,
  VSM_MAP_COARSE_KEEPS_DYNAMIC,
  VSM_MAP_COARSE,
  VSM_MAP_UNCACHED,
  VSM_MAP_COVERAGE,
  VSM_SUN_LEVEL_BIAS,
  VSM_SUN_LEVEL_BIAS_MOVING,
  VSM_UNIT_PER_CM,
  VSM_COVER_SUN,
  VSM_LEVEL0_TEXELS,
  vsmMovingBias,
} from './constants.ts'
import {
  vsmShadowUvMatrix,
  vsmShadowUvNormalMatrix,
  type VsmProjectionDataValues,
} from './projectionData.ts'
import type { VsmCacheManager, VsmLightCache } from './cacheManager.ts'

/** Level radii a level's footprint spans: its corner offset is half of it. */
const LEVEL_SPAN_RADII = 4
const f32 = Math.fround

// ---- Matrix helpers -------------------------------------------------------------------------------

/** `M` applied to the point (x, y, z) (w = 1, no divide). */
export function vsmTransformPoint(
  m: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
  out = new Float64Array(3),
) {
  for (let j = 0; j < 3; j++) out[j] = x * m[j] + y * m[4 + j] + z * m[8 + j] + m[12 + j]
  return out
}
const transposed = new Float64Array(16)
/** The transpose of `m`, into `out` (`m` may be `out`). */
function transposeInto(out: Float64Array, m: ArrayLike<number>) {
  copyMatrix4(transposed, m)
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out[r * 4 + c] = transposed[c * 4 + r]
  return out
}
/** The normalised vector (a tiny vector gives zero), into `out`. */
export function vsmNormalizeOrZero(
  v: ArrayLike<number>,
  out: [number, number, number] = [0, 0, 0],
): [number, number, number] {
  const sq = v[0] * v[0] + v[1] * v[1] + v[2] * v[2]
  if (sq < 1e-8) out[0] = out[1] = out[2] = 0
  else {
    // At sq = 1, s = 1 and v · s = v: an early return gives the same values.
    const s = 1 / Math.sqrt(sq)
    out[0] = v[0] * s
    out[1] = v[1] * s
    out[2] = v[2] * s
  }
  return out
}
/**
 * The world-to-light rotation of the unit direction `d`: the one that takes `d` to +X, without
 * roll. Its rows are the light's axes in the world: `d`; the horizontal axis (−d.y, d.x, 0)/h,
 * h = |(d.x, d.y)|, which keeps the light's Y level; and their cross product (−d.z·d.x/h,
 * −d.z·d.y/h, h), its Z, which leans toward world +Z. A vertical `d` (h = 0) takes world Y as the
 * horizontal axis. Built from the direction's own components, it is exact to the double's rounding
 * (a few units of 2^-52), and the world axes give the identity exactly.
 */
export function vsmWorldToLightRotation(out: Float64Array, d: ArrayLike<number>) {
  const x = d[0],
    y = d[1],
    z = d[2]
  const h = Math.sqrt(x * x + y * y)
  // (cx, cy): the direction's horizontal part made unit, (1, 0) for a vertical `d`.
  let cx = 1,
    cy = 0
  if (h > 0) {
    cx = x / h
    cy = y / h
  }
  out.fill(0)
  // Row 0, the direction; row 1, the horizontal axis; row 2, the third (column-major). Each negated
  // term is `0 −` it: a zero comes out +0, never −0, so the world axes give the identity bit for bit.
  out[0] = x
  out[4] = y
  out[8] = z
  out[1] = 0 - cy
  out[5] = cx
  out[2] = 0 - z * cx
  out[6] = 0 - z * cy
  out[10] = h
  out[15] = 1
  return out
}
/** The face matrix: light +X becomes view +Z. */
export const VSM_FACE_MATRIX = new Float64Array([0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1])
/** The reversed-Z orthographic matrix of (width, height, zScale, zOffset). */
function vsmReversedZOrthoMatrix(
  out: Float64Array,
  width: number,
  height: number,
  zScale: number,
  zOffset: number,
) {
  out.fill(0)
  out[0] = width !== 0 ? 1 / width : 1
  out[5] = height !== 0 ? 1 / height : 1
  out[10] = -zScale
  out[14] = 1 - zOffset * zScale
  out[15] = 1
  return out
}

// ---- Inputs ------------------------------------------------------------------------------------

/** The main view, in the engine's terms (`EngineCamera`). */
export interface VsmCameraInput {
  /** World → view, column-major, right-handed, looking down −Z (`EngineCamera.view`). */
  view: ArrayLike<number>
  /** Engine projection, column-major (`EngineCamera.projection`): x_clip = p[0]·x_view. */
  projection: ArrayLike<number>
  /** Eye position in world metres, double (`EngineCamera.eye`). */
  eye: ArrayLike<number>
  /** The camera's kind as the engine set it (`EngineCamera.perspective` is exactly 0 or 1). */
  perspective: boolean
}

/** The view rect size, in pixels. */
export interface VsmViewport {
  width: number
  height: number
  /**
   * The narrowest width, in pixels, the sun's clipmap sizes its texels for: the display's, so a
   * frame drawn below it (dynamic render scale) keeps the display's shadow resolution. Local
   * lights read `width` and `height` only.
   */
  minScreenWidth?: number
}

/** A directional light as the clipmap reads it. */
interface VsmDirectionalLightInput {
  /** Scene light id (of the cache key). */
  id: string
  /** Propagation direction, from the sun toward the ground (the light's direction). */
  direction: ArrayLike<number>
  /** The light's level bias, default 0. */
  levelBias?: number
  /** The light's texel dither scale, default 1. */
  ditherTexels?: number
}

/** The clipmap's level range and coarse-page marking. */
interface VsmClipmapConfig {
  firstLevel: number
  lastLevel: number
  coarseFrom: number
  coarseTo: number
  levelBias: number
  levelBiasMoving: number
  useCover: boolean
}

/** A level's data, outputs in metres. */
interface VsmClipmapLevel {
  /** Level's view-to-clip, mapping metre view space (the centimetre matrix rescaled). */
  viewToClip: Float64Array
  /** Snapped level centre, world metres (double); originShift = −worldCentre. */
  worldCentre: [number, number, number]
  cornerQuarters: [number, number]
  cornerFromLast: [number, number]
}

export interface VsmClipmap {
  config: VsmClipmapConfig
  light: VsmDirectionalLightInput
  cacheEntry: VsmLightCache
  /** Unit propagation direction (the light's direction). */
  lightDirection: [number, number, number]
  /** Rotation only: world → light view (+Z along the light). */
  lightViewRotation: Float64Array
  /** Clipmap origin (camera position), world metres. */
  eyeWorld: [number, number, number]
  firstLevel: number
  levelBias: number
  levels: VsmClipmapLevel[]
}

/** A level's radius in centimetres (float). */
function vsmClipmapLevelRadiusCm(absoluteLevel: number) {
  return f32(Math.pow(2, f32(absoluteLevel + 1)))
}

/** The clipmap each light's cache entry keeps (`createVsmClipmap`): its matrices, levels and
 *  bounds rewritten in place every frame, made anew with a new entry. */
const CLIPMAPS = new WeakMap<VsmLightCache, VsmClipmap>()
/** The config every clipmap shares: read, never written. */
const GLOBAL_CONFIG: Readonly<VsmClipmapConfig> = Object.freeze(
  (() => {
    return {
      firstLevel: VSM_SUN_FINEST_LEVEL,
      lastLevel: VSM_SUN_COARSEST_LEVEL,
      coarseFrom: VSM_SUN_COARSE_FROM,
      coarseTo: VSM_SUN_COARSE_TO,
      levelBias: VSM_SUN_LEVEL_BIAS,
      levelBiasMoving: VSM_SUN_LEVEL_BIAS_MOVING,
      useCover: VSM_COVER_SUN,
    }
  })(),
)
// The frame's scratch: what a clipmap computes before its cache entry is known, or reads once.
const direction: [number, number, number] = [0, 0, 0],
  cacheKey = { lightDirection: direction, firstLevel: 0 },
  worldToLightRotation = new Float64Array(16),
  worldToLightView = new Float64Array(16),
  viewToWorldRotation = new Float64Array(16),
  cm = new Float64Array(16),
  lastLevelSnap = new Float64Array(3),
  eyeInLight = new Float64Array(3),
  swc = new Float64Array(3),
  entryCell: [number, number] = [0, 0]

/** The clipmap `cacheEntry` keeps, made with it. */
function heldClipmap(cacheEntry: VsmLightCache) {
  let clipmap = CLIPMAPS.get(cacheEntry)
  if (!clipmap)
    CLIPMAPS.set(
      cacheEntry,
      (clipmap = {
        config: GLOBAL_CONFIG,
        light: undefined as unknown as VsmDirectionalLightInput,
        cacheEntry,
        lightDirection: [0, 0, 0],
        lightViewRotation: new Float64Array(16),
        eyeWorld: [0, 0, 0],
        firstLevel: 0,
        levelBias: 0,
        levels: [],
      }),
    )
  return clipmap
}

/** Level `k` of `levels`, made the first time. */
const heldLevel = (levels: VsmClipmapLevel[], k: number) =>
  (levels[k] ??= {
    viewToClip: new Float64Array(16),
    worldCentre: [0, 0, 0],
    cornerQuarters: [0, 0],
    cornerFromLast: [0, 0],
  })

/**
 * Builds a clipmap: finds/updates the light's cache entry, builds
 * every level, runs the per-level cache test and stores each level's projection data in its cache
 * entry (`cacheEntry.mapCaches[i].projectionData`). The clipmap returned is the one the
 * entry keeps (`CLIPMAPS`): the next frame of the same light rewrites it.
 */
export function createVsmClipmap(
  cache: VsmCacheManager,
  light: VsmDirectionalLightInput,
  camera: VsmCameraInput,
  viewport: VsmViewport,
  movingShare: number,
): VsmClipmap {
  const config = GLOBAL_CONFIG
  const lightDirection = vsmNormalizeOrZero(light.direction, direction)
  vsmWorldToLightRotation(worldToLightRotation, lightDirection)
  multiplyMatrix4(worldToLightView, VSM_FACE_MATRIX, worldToLightRotation)
  transposeInto(viewToWorldRotation, worldToLightView)

  // Perspective or not, from the camera's own kind rather than M[3][3] < 1.
  const p = camera.projection
  const isOrthographic = !camera.perspective
  // The projection's X scale in centimetre units: a perspective scale is unitless, an
  // orthographic one is 1 / half-width, per centimetre here.
  const projectionScaleX = isOrthographic ? p[0] / VSM_CM_PER_UNIT : p[0]
  const viewHalfWidth = 1 / projectionScaleX // clip-to-view [0][0] (cm for ortho)
  let screenWidthPx = viewport.width
  if (isOrthographic) screenWidthPx = Math.max(Math.ceil(viewHalfWidth * 2), screenWidthPx)
  screenWidthPx = Math.max(viewport.minScreenWidth ?? 0, screenWidthPx)

  let texelsPerPixel = f32(0.5 / projectionScaleX)
  texelsPerPixel = f32(texelsPerPixel * f32(VSM_LEVEL0_TEXELS / screenWidthPx))
  let levelBias = f32(
    vsmMovingBias(config.levelBias, config.levelBiasMoving, movingShare) +
      Math.log2(texelsPerPixel),
  )
  levelBias = f32(levelBias + (light.levelBias ?? 0))
  // Below 0 a receiver would read a level too small to reach it: a negative light bias sharpens
  // only until it has used up the screen term.
  levelBias = Math.max(0, levelBias)

  // World origin in centimetres. The orthographic view-target projection needs a
  // view target or a world ray cast; with neither, the camera-to-view-target offset stays zero.
  const ox = camera.eye[0] * VSM_CM_PER_UNIT,
    oy = camera.eye[1] * VSM_CM_PER_UNIT,
    oz = camera.eye[2] * VSM_CM_PER_UNIT

  let firstLevel = config.firstLevel
  let lastLevel = config.lastLevel
  if (isOrthographic) {
    const orthoFirstLevel = Math.floor(Math.log2(f32(viewHalfWidth)))
    if (orthoFirstLevel > firstLevel) firstLevel = orthoFirstLevel
    firstLevel = Math.max(firstLevel, 0)
  }
  lastLevel = Math.max(firstLevel, lastLevel)
  const levelCount = lastLevel - firstLevel + 1

  const uncached = !cache.cacheEnabled
  const cacheEntry = cache.lightEntryFor(light.id, levelCount)
  cacheKey.firstLevel = firstLevel
  cacheEntry.updateClipmap(cacheKey, uncached, config.useCover)

  const clipmap = heldClipmap(cacheEntry)
  clipmap.light = light
  for (let k = 0; k < 3; k++) {
    clipmap.lightDirection[k] = lightDirection[k]
    clipmap.eyeWorld[k] = camera.eye[k]
  }
  clipmap.lightViewRotation.set(worldToLightView)
  clipmap.firstLevel = firstLevel
  clipmap.levelBias = levelBias

  vsmTransformPoint(worldToLightView, ox, oy, oz, lastLevelSnap)
  {
    const lastLevelRadius = Math.trunc(vsmClipmapLevelRadiusCm(lastLevel)) // int
    const ux = Math.floor(lastLevelSnap[0] / lastLevelRadius + 0.5),
      uy = Math.floor(lastLevelSnap[1] / lastLevelRadius + 0.5)
    lastLevelSnap[0] = ux * lastLevelRadius
    lastLevelSnap[1] = uy * lastLevelRadius
  }

  const depthSpanRatio = VSM_SUN_DEPTH_SPAN
  vsmTransformPoint(worldToLightView, ox, oy, oz, eyeInLight)
  const levels = clipmap.levels
  levels.length = Math.min(levels.length, levelCount)

  for (let levelIndex = 0; levelIndex < levelCount; levelIndex++) {
    const level = heldLevel(levels, levelIndex)
    const absoluteLevel = levelIndex + firstLevel
    const levelRadiusCm = vsmClipmapLevelRadiusCm(absoluteLevel)
    const halfWidthCm = 2 * levelRadiusCm
    const snapCm = levelRadiusCm

    const csx = Math.floor(eyeInLight[0] / snapCm + 0.5),
      csy = Math.floor(eyeInLight[1] / snapCm + 0.5)
    const snappedX = csx * snapCm,
      snappedY = csy * snapCm
    const cornerQuarters = level.cornerQuarters
    cornerQuarters[0] = -Math.trunc(csx) + LEVEL_SPAN_RADII / 2
    cornerQuarters[1] = Math.trunc(csy) + LEVEL_SPAN_RADII / 2
    vsmTransformPoint(viewToWorldRotation, snappedX, snappedY, eyeInLight[2], swc)

    // The corner offset relative to the origin snapped at the last level, in whole snap steps.
    const levelX = Math.trunc(-snappedX),
      levelY = Math.trunc(snappedY)
    const lastX = Math.trunc(-lastLevelSnap[0]),
      lastY = Math.trunc(lastLevelSnap[1])
    const bias = (LEVEL_SPAN_RADII / 2) * Math.trunc(snapCm)
    level.cornerFromLast[0] = Math.trunc((levelX - lastX + bias) / snapCm) | 0
    level.cornerFromLast[1] = Math.trunc((levelY - lastY + bias) / snapCm) | 0

    const levelEntry = cacheEntry.mapCaches[levelIndex]
    let depthRadius = levelRadiusCm * depthSpanRatio
    entryCell[0] = cornerQuarters[0] * (VSM_LEVEL0_PAGES >> 2)
    entryCell[1] = cornerQuarters[1] * (VSM_LEVEL0_PAGES >> 2)

    levelEntry.updateLevel(cacheEntry, entryCell, levelRadiusCm, eyeInLight[2], depthRadius)
    const eyeDepthShift = eyeInLight[2] - levelEntry.clipmap.depthCentre
    depthRadius = levelEntry.clipmap.depthRadius

    // The matrix in centimetres (cm) and its metre twin (same clip values from metres).
    const zScale = 0.5 / depthRadius
    const zOffset = depthRadius + eyeDepthShift
    vsmReversedZOrthoMatrix(cm, halfWidthCm, halfWidthCm, zScale, zOffset)
    const viewToClip = vsmReversedZOrthoMatrix(
      level.viewToClip,
      halfWidthCm * VSM_UNIT_PER_CM,
      halfWidthCm * VSM_UNIT_PER_CM,
      zScale * VSM_CM_PER_UNIT,
      zOffset * VSM_UNIT_PER_CM,
    )
    viewToClip[14] = cm[14] // 1 − zOffset·zScale is unitless: keep the exact value

    for (let k = 0; k < 3; k++) level.worldCentre[k] = swc[k] * VSM_UNIT_PER_CM
  }

  for (let i = 0; i < levelCount; i++)
    vsmClipmapProjectionData(clipmap, i, cacheEntry.mapCaches[i].projectionData)
  return clipmap
}

/** The projection shader data, written into the record `out`. */
function vsmClipmapProjectionData(
  clipmap: VsmClipmap,
  levelIndex: number,
  out: VsmProjectionDataValues,
) {
  const level = clipmap.levels[levelIndex],
    config = clipmap.config
  const originShift = out.originShift
  for (let k = 0; k < 3; k++) {
    originShift[k] = -level.worldCentre[k]
    out.lightDirection[k] = -clipmap.lightDirection[k]
    // The world origin plus the origin shift, as a 3-vector of floats.
    out.clipmapOrigin[k] = clipmap.eyeWorld[k] + originShift[k]
  }
  out.lightViewToClip.set(level.viewToClip)
  vsmShadowUvMatrix(out.shiftedToMapUv, clipmap.lightViewRotation, level.viewToClip)
  vsmShadowUvNormalMatrix(out.planesToMapUv, clipmap.lightViewRotation, level.viewToClip)
  out.cornerSteps[0] = level.cornerFromLast[0]
  out.cornerSteps[1] = level.cornerFromLast[1]
  const mapLevel = clipmap.firstLevel + levelIndex
  const levelsAfterThis = clipmap.levels.length - levelIndex
  let flags = clipmap.cacheEntry.isUncached ? VSM_MAP_UNCACHED : 0
  if (config.coarseFrom >= 0) {
    if ((mapLevel >= config.coarseFrom && mapLevel <= config.coarseTo) || levelsAfterThis === 1)
      flags |= VSM_MAP_COARSE
  }
  if (config.useCover) flags |= VSM_MAP_COVERAGE
  flags |= VSM_MAP_COARSE_KEEPS_DYNAMIC
  out.lightKind = VSM_LIGHT_KIND_DIRECTIONAL
  out.lightRange = 0
  out.levelBias = clipmap.levelBias
  out.emitterSize = 0 // a directional light has no source radius
  out.mapLevel = mapLevel
  out.levelsLeft = levelsAfterThis
  out.flags = flags
  out.ditherTexels = clipmap.light.ditherTexels ?? 1
  out.finestMip = 0
}
