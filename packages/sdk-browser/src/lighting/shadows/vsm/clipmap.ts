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
 * `multiplyMatrix4(out, A, B)` is A·B, B applied first; `transformAffinePoint` applies one to a point.
 */
import { LIGHT_KIND } from '../../../../../sdk-core/src/scene/light/contracts.ts'
import {
  LIGHT_SHADOW_FIELDS,
  resolveLightShadow,
  type LightShadow,
} from '../../../../../sdk-core/src/contracts/lightShadowOptions.ts'
import type { SunCascades } from '../../../../../sdk-core/src/contracts/sunCascades.ts'
import { FLOAT32_MAX } from '../../../../../math/src/constants.ts'
import { multiplyMatrix4, transposeMatrix4 } from '../../../../../math/src/matrix/matrix4.ts'
import { forwardOrthographicProjection } from '../../../../../math/src/projection/forwardZ.ts'
import {
  length2,
  normalizeVector3OrZero,
  transformAffinePoint,
} from '../../../../../math/src/vector/vector.ts'
import {
  VSM_CM_PER_UNIT,
  VSM_LEVEL0_PAGES,
  VSM_MAP_COARSE_KEEPS_DYNAMIC,
  VSM_MAP_FIRST_PERSON,
  VSM_MAP_COARSE,
  VSM_MAP_UNCACHED,
  VSM_MAP_COVERAGE,
  VSM_UNIT_PER_CM,
  VSM_LEVEL0_TEXELS,
} from './constants.ts'
import {
  VSM_DEFAULT_MAPS,
  vsmClipmapConfig,
  vsmFirstPersonClipmapConfig,
  vsmLightMobility,
  vsmSunBias,
  type VsmClipmapConfig,
  type VsmMapSettings,
} from './mapSettings.ts'
import {
  copyVsmProjectionGeometry,
  vsmShadowMatrices,
  type VsmProjectionDataValues,
} from './projection/projectionData.ts'
import { VSM_MAP_LEVEL_INDEX_SHIFT, VSM_MAP_PREFILTERED_DISTANT } from './prefilteredConstants.ts'
import { viewOrigin } from './viewOrigin.ts'
import type { VsmCacheManager } from './cacheManager.ts'
import type { VsmLightCache } from './lightCache.ts'

/** Level radii a level's footprint spans: its corner offset is half of it. */
const LEVEL_SPAN_RADII = 4

// ---- Matrix helpers -------------------------------------------------------------------------------

/** The squared length below which a light direction counts as none: it normalises to zero. */
export const VSM_MIN_DIRECTION_SQ = 1e-8
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
  const h = length2(x, y)
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
  /** The offset from the eye, in metres, the view's clipmaps are centred on (`viewOrigin.ts`): the
   *  point it frames, or what its line of sight meets; zeros or absent for none
   *  (`frame/vsmViewOrigin.ts`, which gates it to an orthographic view). */
  viewTarget?: ArrayLike<number>
  /** The view it draws (`WebgpuView.id`), whose suns' clipmaps are its own; the main one's
   *  (`''`) when none is said. */
  viewId?: string
}

/** The view rect size, in pixels. */
export interface VsmViewport {
  width: number
  height: number
  /**
   * The narrowest width, in pixels, the sun's clipmap sizes its texels for
   * (`shadowClipmapMinCameraViewportWidth`): a frame drawn below it keeps that width's shadow
   * resolution; 0 floors nothing. Local lights read `width` and `height` only.
   */
  minScreenWidth?: number
}

/** What every light's maps add to the resolution bias and scale the texel dither by, whatever the
 *  light: a light carries neither of its own. */
export const VSM_LIGHT_SHADOW = { levelBias: 0, ditherTexels: 1 } as const

/** A directional light as the clipmap reads it. */
interface VsmDirectionalLightInput {
  /** Scene light id (of the cache key). */
  id: string
  /** Propagation direction, from the sun toward the ground (the light's direction). */
  direction: ArrayLike<number>
  /** Whether the light is `movable`: only a movable light takes the moving bias (`vsmLightMobility`). */
  movable?: boolean
  /** The cascades the frame laid for it (`sunCascades`): no part of the cache key. */
  cascades?: SunCascades
  /** Whether this is the sun's first-person clipmap (`shadowFirstPersonClipmap`): its own levels, no
   *  cache (drawn again each frame), its maps flagged (`VSM_MAP_FIRST_PERSON`) for the objects that stand
   *  for a first-person one alone. Its `id` names it apart from the sun's own. */
  firstPerson?: boolean
  /** The classic cascades the sun is drawn in (`shadowVirtualEnable` off): its entry holds one map more for each, after its levels' (`vsmClipmapCascadeMap`). */
  cascadeMaps?: number
  /** The light's own shadow settings (`LightShadow`; absent, the defaults): part of the cache key,
   *  as a light that any of them re-creates holds none of its cached pages. */
  shadow?: LightShadow
}

/** A level's data, outputs in metres. */
interface VsmClipmapLevel {
  /** Level's view-to-clip, mapping metre view space (the centimetre matrix rescaled). */
  viewToClip: Float64Array
  /** Snapped level centre, world metres (double); originShift = −worldCentre. */
  worldCentre: [number, number, number]
  cornerFromLast: [number, number]
  /** The level's cell in the pages' grid, the depth its cache entry was last asked at and the depth radius it holds (centimetres): what a classic cascade's own map is asked the same. */
  pageCell: [number, number]
  depthCentre: number
  depthRadius: number
  /** Square of the distance, metres, past which the level draws no object's offset; 0 where the
   *  rule is off (`vsmWpoThreshold`). */
  wpoThreshold: number
  /** The clip depth short of which a moving caster is not drawn into the level
   *  (`VsmProjectionDataValues.dynamicDepthCullRange`); 0 for no limit. */
  dynamicCullNear: number
  /** The far end of that range: the greatest float for no limit; with the prefiltered distant shadow
   *  the clip depth of the level's own radius, the range the band the level draws into the filtered
   *  pages. */
  dynamicCullFar: number
}

export interface VsmClipmap {
  light: VsmDirectionalLightInput
  cacheEntry: VsmLightCache
  /** Unit propagation direction (the light's direction). */
  lightDirection: [number, number, number]
  /** Rotation only: world → light view (+Z along the light). */
  lightViewRotation: Float64Array
  /** Clipmap origin (the camera position, moved onto an orthographic view's target), world metres. */
  originWorld: [number, number, number]
  firstLevel: number
  levelBias: number
  levels: VsmClipmapLevel[]
}

/** A level's radius in centimetres (float). */
function vsmClipmapLevelRadiusCm(absoluteLevel: number) {
  return Math.fround(Math.pow(2, Math.fround(absoluteLevel + 1)))
}

/** The shadow settings of a light that names none: every default. */
const DEFAULT_LIGHT_SHADOW = /* @__PURE__ */ resolveLightShadow({})
// The frame's scratch: what a clipmap computes before its cache entry is known, or reads once.
const direction: [number, number, number] = [0, 0, 0],
  cacheKey = { lightDirection: direction, firstLevel: 0, shadow: [] as number[] },
  worldToLightRotation = new Float64Array(16),
  worldToLightView = new Float64Array(16),
  viewToWorldRotation = new Float64Array(16),
  lastLevelSnap = new Float64Array(3),
  eyeInLight = new Float64Array(3),
  originScratch = new Float64Array(3),
  swc = new Float64Array(3),
  entryCell: [number, number] = [0, 0]

/** The clipmap `cacheEntry` keeps, made with it. */
function heldClipmap(cacheEntry: VsmLightCache) {
  return (cacheEntry.clipmap ??= {
    light: undefined as unknown as VsmDirectionalLightInput,
    cacheEntry,
    lightDirection: [0, 0, 0],
    lightViewRotation: new Float64Array(16),
    originWorld: [0, 0, 0],
    firstLevel: 0,
    levelBias: 0,
    levels: [],
  })
}

/** Level `k` of `levels`, made the first time. */
const heldLevel = (levels: VsmClipmapLevel[], k: number) =>
  (levels[k] ??= {
    viewToClip: new Float64Array(16),
    worldCentre: [0, 0, 0],
    cornerFromLast: [0, 0],
    pageCell: [0, 0],
    depthCentre: 0,
    depthRadius: 0,
    wpoThreshold: 0,
    dynamicCullNear: 0,
    dynamicCullFar: FLOAT32_MAX,
  })

/** The projection's X scale in centimetre units: a perspective scale is unitless, an orthographic
 *  one is 1 / half-width, per centimetre here. */
const projectionScaleX = ({ projection, perspective }: VsmCameraInput) =>
  perspective ? projection[0] : projection[0] / VSM_CM_PER_UNIT

/** The clipmap's resolution bias from the screen: log2 of the level-0 texels a pixel spans, the
 *  setting's width (`VsmViewport.minScreenWidth`) the floor of the drawn one; an orthographic view
 *  takes the wider of its own width, `viewHalfWidth` doubled, and the drawn one. */
function clipmapScreenBias(camera: VsmCameraInput, viewport: VsmViewport, viewHalfWidth: number) {
  let screenWidthPx = viewport.width
  if (!camera.perspective) screenWidthPx = Math.max(Math.ceil(viewHalfWidth * 2), screenWidthPx)
  screenWidthPx = Math.max(viewport.minScreenWidth ?? 0, screenWidthPx)
  // An orthographic view has no field of view to scale by: its projection scale is 1.
  const texelsPerPixel = Math.fround(0.5 / (camera.perspective ? camera.projection[0] : 1))
  return Math.log2(Math.fround(texelsPerPixel * Math.fround(VSM_LEVEL0_TEXELS / screenWidthPx)))
}

/** The first level of a view: the settings', an orthographic view's own width raising it
 *  (`shadowOrthoEstimateClipmapLevels`), then `shadowOrthoClipmapLodBias` levels added, never below 0. */
function firstLevelOf(config: VsmClipmapConfig, isOrthographic: boolean, viewHalfWidth: number) {
  if (!isOrthographic || !config.orthoEstimateLevels) return config.firstLevel
  const orthoFirstLevel = Math.floor(Math.log2(Math.fround(viewHalfWidth)))
  return Math.max(Math.max(config.firstLevel, orthoFirstLevel) + config.orthoLodBias, 0)
}

/** The light's cache entry told this frame's key — its first level and its own shadow settings —,
 *  whether it is drawn `uncached` and whether it draws for the receivers' cover (`useCover`). */
function updateEntry(
  cacheEntry: VsmLightCache,
  light: VsmDirectionalLightInput,
  firstLevel: number,
  uncached: boolean,
  useCover: boolean,
) {
  cacheKey.firstLevel = firstLevel
  const own = light.shadow ?? DEFAULT_LIGHT_SHADOW
  for (let k = 0; k < LIGHT_SHADOW_FIELDS.length; k++)
    cacheKey.shadow[k] = Number(own[LIGHT_SHADOW_FIELDS[k]!])
  cacheEntry.updateClipmap(cacheKey, uncached, useCover)
}

/** The eye's place at the last level's snap, into `lastLevelSnap`: the origin the levels' corners
 *  are counted from, in whole steps of that level. */
function snapLastLevel(ox: number, oy: number, oz: number, lastLevel: number) {
  transformAffinePoint(lastLevelSnap, worldToLightView, ox, oy, oz)
  const lastLevelRadius = Math.trunc(vsmClipmapLevelRadiusCm(lastLevel)) // int
  const ux = Math.floor(lastLevelSnap[0] / lastLevelRadius + 0.5),
    uy = Math.floor(lastLevelSnap[1] / lastLevelRadius + 0.5)
  lastLevelSnap[0] = ux * lastLevelRadius
  lastLevelSnap[1] = uy * lastLevelRadius
}

/** The clip depth of the view-space depth `z` (centimetres) under the level's reversed-Z
 *  orthographic projection of depth scale `zScale`: its depth row, `-zScale · z` and the offset term
 *  `viewToClip[14]`. */
const depthOfViewZ = (viewToClip: ArrayLike<number>, zScale: number, z: number) =>
  z * -zScale + viewToClip[14]

/** The level's view-to-clip from metres and the distances its moving casters are drawn between; where the level ends its band (centimetres). */
function projectLevel(
  clipmap: VsmClipmap,
  level: VsmClipmap['levels'][number],
  levelEntry: VsmClipmap['cacheEntry']['mapCaches'][number],
  absoluteLevel: number,
  halfWidthCm: number,
  depthRadius: number,
  config: VsmClipmapConfig,
  prevCullDistance: number,
) {
  // The level's view-to-clip from metres; its depth offset 1 − zOffset·zScale is unitless,
  // taken from the centimetre values themselves: the exact value, no unit round trip. The
  // distance its moving casters are drawn to is the level's own radius less the resolution bias.
  const cullingEnd = vsmClipmapLevelRadiusCm(absoluteLevel - clipmap.levelBias)
  let zScale: number, zOffset: number
  level.dynamicCullNear = 0
  if (config.forceInvalidate && config.cullTightly) {
    // Nothing is cached: the far plane is the end of the range the level shows, no eye shift.
    zScale = 1 / (cullingEnd + depthRadius)
    zOffset = depthRadius
  } else {
    zScale = 0.5 / depthRadius
    zOffset = depthRadius + (eyeInLight[2] - levelEntry.clipmap.depthCentre)
    // The moving casters are uncached (the receiver cover): culled past the range the level shows.
    if (config.useCover && config.cullTightly)
      level.dynamicCullNear = 1 - (cullingEnd + zOffset) * zScale
  }
  const viewToClip = forwardOrthographicProjection(
    level.viewToClip,
    halfWidthCm * VSM_UNIT_PER_CM,
    halfWidthCm * VSM_UNIT_PER_CM,
    zScale * VSM_CM_PER_UNIT,
    zOffset * VSM_UNIT_PER_CM,
  )
  viewToClip[14] = 1 - zOffset * zScale

  level.dynamicCullFar = FLOAT32_MAX
  if (config.prefilteredDistant) {
    // The band this level draws into the filtered pages: from where the level before ends its band
    // to the end of this one's, toward the light (the clip depth of a point `distance` along it is
    // that of -distance in the level's view).
    level.dynamicCullNear = depthOfViewZ(viewToClip, zScale, -prevCullDistance)
    level.dynamicCullFar = depthOfViewZ(viewToClip, zScale, -cullingEnd)
  }
  return cullingEnd
}

/** The level's corner snapped to whole steps of `snapCm` under the eye, its offset from the last level's written into `level`, and its world centre in `swc`. */
function snapLevel(level: VsmClipmap['levels'][number], snapCm: number) {
  const csx = Math.floor(eyeInLight[0] / snapCm + 0.5),
    csy = Math.floor(eyeInLight[1] / snapCm + 0.5)
  const snappedX = csx * snapCm,
    snappedY = csy * snapCm
  const cornerX = -Math.trunc(csx) + LEVEL_SPAN_RADII / 2,
    cornerY = Math.trunc(csy) + LEVEL_SPAN_RADII / 2
  transformAffinePoint(swc, viewToWorldRotation, snappedX, snappedY, eyeInLight[2])

  // The corner offset relative to the origin snapped at the last level, in whole snap steps.
  const levelX = Math.trunc(-snappedX),
    levelY = Math.trunc(snappedY)
  const lastX = Math.trunc(-lastLevelSnap[0]),
    lastY = Math.trunc(lastLevelSnap[1])
  const bias = (LEVEL_SPAN_RADII / 2) * Math.trunc(snapCm)
  level.cornerFromLast[0] = Math.trunc((levelX - lastX + bias) / snapCm) | 0
  level.cornerFromLast[1] = Math.trunc((levelY - lastY + bias) / snapCm) | 0
  return { cornerX, cornerY }
}

/** Level `levelIndex` of `clipmap` (its first level `firstLevel`, the depth of its levels
 *  `depthSpanRatio` times their radius): its snapped corner, its offset from the last level's, its
 *  cache entry's depth range and its projection from metres. `prevCullDistance`, in centimetres, is
 *  where the level before ends its band (0 for the first); returns where this one ends it. */
function buildLevel(
  clipmap: VsmClipmap,
  levelIndex: number,
  firstLevel: number,
  depthSpanRatio: number,
  config: VsmClipmapConfig,
  prevCullDistance: number,
) {
  const level = heldLevel(clipmap.levels, levelIndex)
  const absoluteLevel = levelIndex + firstLevel
  const levelRadiusCm = vsmClipmapLevelRadiusCm(absoluteLevel)
  const halfWidthCm = 2 * levelRadiusCm
  const snapCm = levelRadiusCm

  const { cornerX, cornerY } = snapLevel(level, snapCm)

  const levelEntry = clipmap.cacheEntry.mapCaches[levelIndex]
  let depthRadius = levelRadiusCm * depthSpanRatio
  entryCell[0] = cornerX * (VSM_LEVEL0_PAGES >> 2)
  entryCell[1] = cornerY * (VSM_LEVEL0_PAGES >> 2)

  level.wpoThreshold = config.wpoDisable
    ? vsmWpoThreshold(absoluteLevel, config.wpoLodBias, clipmap.levelBias)
    : 0
  levelEntry.updateLevel(
    clipmap.cacheEntry,
    entryCell,
    levelRadiusCm,
    eyeInLight[2],
    depthRadius,
    level.wpoThreshold,
    config.wpoInvalidatesOnScale,
  )
  depthRadius = levelEntry.clipmap.depthRadius
  level.pageCell[0] = entryCell[0]
  level.pageCell[1] = entryCell[1]
  level.depthCentre = eyeInLight[2]
  level.depthRadius = depthRadius

  const cullingEnd = projectLevel(
    clipmap,
    level,
    levelEntry,
    absoluteLevel,
    halfWidthCm,
    depthRadius,
    config,
    prevCullDistance,
  )
  for (let k = 0; k < 3; k++) level.worldCentre[k] = swc[k] * VSM_UNIT_PER_CM
  return cullingEnd
}

/** The light's bias: the view's, coarser while the light moves (`vsmLightMobility`, by its
 *  `pose`: its direction). */
function lightLevelBias(
  cache: VsmCacheManager,
  light: VsmDirectionalLightInput,
  maps: VsmMapSettings,
  pose: ArrayLike<number>,
  screenBias: number,
) {
  const { shadows } = maps
  const frame = maps.frame,
    active = shadows.shadowLightActiveFrameCount
  const mobility = light.firstPerson
    ? 1
    : light.movable
      ? vsmLightMobility(cache.lightMoves, light.id, pose, frame, active)
      : 0
  return vsmSunBias(shadows, mobility, screenBias, VSM_LIGHT_SHADOW.levelBias)
}

/** The light's clipmap held by its cache entry, rewritten for this frame's light, direction, origin and first level. */
function fillClipmap(
  cacheEntry: Parameters<typeof heldClipmap>[0],
  light: VsmDirectionalLightInput,
  lightDirection: ArrayLike<number>,
  origin: ArrayLike<number>,
  firstLevel: number,
  levelBias: number,
) {
  const clipmap = heldClipmap(cacheEntry)
  clipmap.light = light
  for (let k = 0; k < 3; k++) {
    clipmap.lightDirection[k] = lightDirection[k]
    clipmap.originWorld[k] = origin[k]
  }
  clipmap.lightViewRotation.set(worldToLightView)
  clipmap.firstLevel = firstLevel
  clipmap.levelBias = levelBias
  return clipmap
}

/**
 * Builds a clipmap: finds/updates the light's cache entry, builds
 * every level, runs the per-level cache test and stores each level's projection data in its cache
 * entry (`cacheEntry.mapCaches[i].projectionData`). The clipmap returned is the one the
 * entry keeps (`VsmLightCache.clipmap`): the next frame of the same light rewrites it. Its levels,
 * their depth range, its coarse pages and its resolution bias are the settings' (`maps`).
 */
export function createVsmClipmap(
  cache: VsmCacheManager,
  light: VsmDirectionalLightInput,
  camera: VsmCameraInput,
  viewport: VsmViewport,
  maps: VsmMapSettings = VSM_DEFAULT_MAPS,
): VsmClipmap {
  const { shadows } = maps,
    config = light.firstPerson ? vsmFirstPersonClipmapConfig(shadows) : vsmClipmapConfig(shadows)
  const lightDirection = normalizeVector3OrZero(direction, light.direction, VSM_MIN_DIRECTION_SQ)
  vsmWorldToLightRotation(worldToLightRotation, lightDirection)
  multiplyMatrix4(worldToLightView, VSM_FACE_MATRIX, worldToLightRotation)
  transposeMatrix4(viewToWorldRotation, worldToLightView)

  // Perspective or not, from the camera's own kind rather than M[3][3] < 1.
  const viewHalfWidth = 1 / projectionScaleX(camera)
  const screenBias = clipmapScreenBias(camera, viewport, viewHalfWidth)

  // World origin in metres: the eye, moved onto an orthographic view's target (`viewOrigin`); in
  // centimetres for the levels.
  const origin = viewOrigin(originScratch, camera)
  const ox = origin[0] * VSM_CM_PER_UNIT,
    oy = origin[1] * VSM_CM_PER_UNIT,
    oz = origin[2] * VSM_CM_PER_UNIT

  const firstLevel = firstLevelOf(config, !camera.perspective, viewHalfWidth)
  const lastLevel = Math.max(firstLevel, config.lastLevel)
  const levelCount = lastLevel - firstLevel + 1

  const shadowType = light.firstPerson ? 1 : 0
  const cacheEntry = cache.lightEntryFor(
    light.id,
    levelCount + (light.cascadeMaps ?? 0),
    camera.viewId ?? '',
    shadowType,
  )
  // A clipmap that keeps nothing from one frame to the next is drawn uncached (the first-person
  // one always, and biased as a moving light).
  updateEntry(
    cacheEntry,
    light,
    firstLevel,
    !cache.cacheEnabled || config.forceInvalidate,
    config.useCover,
  )
  const levelBias = lightLevelBias(cache, light, maps, lightDirection, screenBias)

  const clipmap = fillClipmap(cacheEntry, light, lightDirection, origin, firstLevel, levelBias)
  snapLastLevel(ox, oy, oz, lastLevel)
  transformAffinePoint(eyeInLight, worldToLightView, ox, oy, oz)
  clipmap.levels.length = Math.min(clipmap.levels.length, levelCount)
  let prevCullDistance = 0
  for (let levelIndex = 0; levelIndex < levelCount; levelIndex++)
    prevCullDistance = buildLevel(
      clipmap,
      levelIndex,
      firstLevel,
      shadows.shadowClipmapZRangeScale,
      config,
      prevCullDistance,
    )
  for (let i = 0; i < levelCount; i++)
    vsmClipmapProjectionData(clipmap, i, cacheEntry.mapCaches[i].projectionData, config)
  return clipmap
}

/**
 * Makes map `mapIndex` of the clipmap's entry (one past its levels, `VsmDirectionalLightInput.cascadeMaps`) the map of a classic cascade drawn in level `levelIndex`: the level's
 * geometry by reference, its own pages, cache state and draw bias, as each cascade has a shadow map of its own. Two cascades of one level are two maps.
 */
export function vsmClipmapCascadeMap(
  clipmap: VsmClipmap,
  levelIndex: number,
  mapIndex: number,
  wpoInvalidates: boolean,
) {
  const { cacheEntry } = clipmap
  const level = clipmap.levels[levelIndex]
  const map = cacheEntry.mapCaches[mapIndex]
  copyVsmProjectionGeometry(map.projectionData, cacheEntry.mapCaches[levelIndex].projectionData)
  map.updateLevel(
    cacheEntry,
    level.pageCell,
    vsmClipmapLevelRadiusCm(clipmap.firstLevel + levelIndex),
    level.depthCentre,
    level.depthRadius,
    level.wpoThreshold,
    wpoInvalidates,
  )
  return map
}

/**
 * The square of the distance, in metres, past which a clipmap level draws no object's offset: the
 * level is shown from far enough that the motion of an object whose offset stops nearer than its
 * `lodBias` levels past the distance cannot be seen in it. Two to the power of twice the level less
 * the bias and the clipmap's `resolutionBias` (that of its levels' records), rounded up to a whole
 * level — the levels are powers of two, so a change of the view redraws no page for it unless
 * `shadowClipmapWpoDisableDistanceInvalidateOnScaleChange` is on —, the radius' centimetres taken to
 * metres. An object evaluates its offset in the level while this does not pass its own square
 * (`wpoAllowed`, `../../../visibility/shader/wpoGraphWgsl.ts`).
 */
function vsmWpoThreshold(absoluteLevel: number, lodBias: number, resolutionBias: number) {
  const level = Math.ceil(absoluteLevel - lodBias - resolutionBias)
  return Math.fround(Math.pow(2, 2 * level) * VSM_UNIT_PER_CM * VSM_UNIT_PER_CM)
}

/** The projection shader data, written into the record `out`. */
function vsmClipmapProjectionData(
  clipmap: VsmClipmap,
  levelIndex: number,
  out: VsmProjectionDataValues,
  config: VsmClipmapConfig,
) {
  const level = clipmap.levels[levelIndex]
  const originShift = out.originShift
  for (let k = 0; k < 3; k++) {
    originShift[k] = -level.worldCentre[k]
    out.lightDirection[k] = -clipmap.lightDirection[k]
    // The world origin plus the origin shift, as a 3-vector of floats.
    out.clipmapOrigin[k] = clipmap.originWorld[k] + originShift[k]
  }
  out.lightViewToClip.set(level.viewToClip)
  vsmShadowMatrices(out, clipmap.lightViewRotation, level.viewToClip)
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
  if (clipmap.light.firstPerson) flags |= VSM_MAP_FIRST_PERSON
  if (config.keepsDynamic) flags |= VSM_MAP_COARSE_KEEPS_DYNAMIC
  if (config.prefilteredDistant)
    flags |= VSM_MAP_PREFILTERED_DISTANT | (levelIndex << VSM_MAP_LEVEL_INDEX_SHIFT)
  out.lightKind = LIGHT_KIND.directional
  out.lightRange = 0
  out.levelBias = clipmap.levelBias
  out.emitterSize = 0 // a directional light has no source radius
  out.mapLevel = mapLevel
  out.wpoThreshold = level.wpoThreshold
  out.dynamicDepthCullRange[0] = level.dynamicCullNear
  out.dynamicDepthCullRange[1] = level.dynamicCullFar
  out.levelsLeft = levelsAfterThis
  out.flags = flags
  out.ditherTexels = VSM_LIGHT_SHADOW.ditherTexels
  out.finestMip = 0
}
