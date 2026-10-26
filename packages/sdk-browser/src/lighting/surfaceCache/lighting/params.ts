import { ceilDiv, nextPow2 } from '../../../../../math/src/scalar/integers.ts'
import { length3 } from '../../../../../math/src/vector/vector.ts'
import { DISTANCE_FIELD_UNITS_PER_METRE as CM } from '../../../../../sdk-core/src/contracts/distanceFieldAbi.ts'
import type { SurfaceCacheSettings } from '../../../../../sdk-core/src/contracts/surfaceCacheOptions.ts'
import {
  hemisphereResolution,
  lightsPerTile,
  probeSpacing,
  updateTilesOf,
} from '../../../../../sdk-core/src/lighting/surfaceCache/lightingMath.ts'
import { CARD_TILE_SIZE } from '../../../../../sdk-core/src/lighting/surfaceCache/cardResolution.ts'
import { BOUNCE_SETTINGS } from '../../../../../sdk-core/src/bounce/contracts.ts'
import { contextLayout, LIGHTING_FLAG, LIGHTING_PARAMS } from './layout.ts'

/**
 * WHAT AN IMAGE'S LIGHTING IS SIZED BY, and the parameters written from it (`LIGHTING_PARAMS`): the settings' numbers made
 * what the kernels read — the tiles each update lights, the lists' capacities and places, the radiosity's spacing and
 * hemisphere —, the frustum the pages' priority is measured against, and the eye. `shapeOf` is what the resources and the
 * programs are made for (`shapeKey` says when they must be made again); `writeLightingParams` is the image's.
 */

/** The longest a ray of the lighting travels, in centimetres: the bounce's reach. */
const MAX_TRACE = BOUNCE_SETTINGS.rayReachMetres * CM

/** What the lighting's resources and programs are made for. */
export interface LightingShape {
  readonly side: number
  readonly compressed: boolean
  readonly directTiles: number
  readonly indirectTiles: number
  readonly maxLights: number
  readonly radiosity: boolean
  readonly spacing: number
  readonly hemisphere: number
  /** The radiosity tiles the list holds, the probes in each and the rays of a probe. */
  readonly radiosityTiles: number
  readonly probesPerTile: number
  readonly raysPerProbe: number
}

/** The shape of the lighting of an atlas of `side` texels, `compressed` or not, under `settings`. */
export function shapeOf(
  settings: SurfaceCacheSettings,
  side: number,
  compressed: boolean,
): LightingShape {
  const tiles = updateTilesOf(settings, side)
  const spacing = probeSpacing(
    settings.surfaceCacheRadiosityProbeSpacing,
    settings.surfaceCacheLightingQuality,
  )
  const hemisphere = hemisphereResolution(
    settings.surfaceCacheRadiosityHemisphereProbeResolution,
    settings.surfaceCacheLightingQuality,
  )
  const tileSize = spacing >= 4 ? spacing : CARD_TILE_SIZE
  const along = CARD_TILE_SIZE / tileSize
  return {
    side,
    compressed,
    directTiles: tiles.direct,
    indirectTiles: tiles.indirect,
    maxLights: lightsPerTile(settings.surfaceCacheDirectLightingMaxLightsPerTile),
    radiosity: settings.surfaceCacheRadiosity,
    spacing,
    hemisphere,
    radiosityTiles: tiles.indirect * along * along,
    probesPerTile: (tileSize / spacing) ** 2,
    raysPerProbe: hemisphere * hemisphere,
  }
}

/** The shape as a key: two images with the same key use the same resources and programs. */
export const shapeKey = (shape: LightingShape) => JSON.stringify(shape)

/** The words of the context's buffer, the lights' lists and the filtered rays of a shape, and its probes' atlas sizes. */
export function sizesOf(shape: LightingShape) {
  const context = contextLayout(
    shape.directTiles,
    shape.indirectTiles,
    shape.radiosity ? shape.radiosityTiles : 0,
  )
  const probes = ceilDiv(shape.side, shape.spacing)
  return {
    context,
    tileLightsWords: shape.directTiles * (shape.maxLights + 1),
    filteredWords: shape.radiosity
      ? shape.radiosityTiles * shape.probesPerTile * shape.raysPerProbe
      : 1,
    probeAtlas: shape.radiosity ? probes : 1,
    traceAtlas: shape.radiosity ? probes * shape.hemisphere : 1,
  }
}

/**
 * Writes the five planes of the frustum of the world-to-clip matrix `viewProjection` (column-major, in metres, depth
 * reversed: near at 1) into `out` from word `at`, as `LIGHTING_PARAMS.frustum` holds them: each plane's outward normal and,
 * in the fourth, its distance — a point `q` centimetres from `eye` is that far outside it where `dot(normal, q) + distance` is
 * positive. The planes are the left, right, bottom, top and near.
 */
function frustumPlanes(
  viewProjection: ArrayLike<number>,
  eye: ArrayLike<number>,
  out: Float32Array,
  at: number,
) {
  const row = (r: number) => [0, 1, 2, 3].map((c) => viewProjection[c * 4 + r])
  const [x, y, z, w] = [row(0), row(1), row(2), row(3)]
  const inward = [
    w.map((v, k) => v + x[k]),
    w.map((v, k) => v - x[k]),
    w.map((v, k) => v + y[k]),
    w.map((v, k) => v - y[k]),
    w.map((v, k) => v - z[k]),
  ]
  inward.forEach(([a, b, c, d], plane) => {
    const length = length3(a, b, c) || 1
    const atEye = a * eye[0] + b * eye[1] + c * eye[2] + d
    out.set([-a / length, -b / length, -c / length, (-CM * atEye) / length], at + 4 * plane)
  })
}

/** What an image gives the lighting beside the settings. */
export interface LightingImage {
  readonly frame: number
  readonly pages: number
  /** The eye, in metres, and the view's world-to-clip matrix. */
  readonly eye: ArrayLike<number>
  readonly viewProjection: ArrayLike<number>
  /** The number the light is kept multiplied by, and the view's pre-exposure. */
  readonly preExposure: number
  readonly viewPreExposure: number
  /** The first clipmap's half side of the global field, in centimetres. */
  readonly firstClipmapExtent: number
  /** Whether the radiosity's history was lost since the last image. */
  readonly historyLost: boolean
}

/** Writes the parameters of an image into `words`, `LIGHTING_PARAMS.words` long. */
export function writeLightingParams(
  words: Uint32Array,
  shape: LightingShape,
  settings: SurfaceCacheSettings,
  image: LightingImage,
) {
  const floats = new Float32Array(words.buffer, words.byteOffset, words.length)
  const ints = new Int32Array(words.buffer, words.byteOffset, words.length)
  const at = LIGHTING_PARAMS.at
  const { context } = sizesOf(shape)
  const flags =
    (settings.surfaceCacheDirectLighting ? LIGHTING_FLAG.direct : 0) |
    (shape.radiosity ? LIGHTING_FLAG.radiosity : 0) |
    (settings.surfaceCacheLightingMaxDistanceFromFrustumToPrioritize >= 0
      ? LIGHTING_FLAG.prioritizeFrustum
      : 0) |
    (settings.surfaceCacheRadiositySpatialFilterProbes &&
    settings.surfaceCacheRadiositySpatialFilterProbesKernelSize > 0
      ? LIGHTING_FLAG.filter
      : 0) |
    (settings.surfaceCacheRadiosityTemporal ? LIGHTING_FLAG.temporal : 0) |
    (settings.surfaceCacheRadiosityProbePlaneWeighting ? LIGHTING_FLAG.planeWeighting : 0) |
    (image.historyLost ? 0 : LIGHTING_FLAG.historyValid)
  words.fill(0)
  words[at.atlasSide] = shape.side
  words[at.frame] = image.frame
  words[at.pages] = image.pages
  words[at.flags] = flags
  words[at.directTiles] = shape.directTiles
  words[at.indirectTiles] = shape.indirectTiles
  words[at.directAt] = context.directAt
  words[at.indirectAt] = context.indirectAt
  words[at.radiosityAt] = context.radiosityAt
  words[at.radiosityTiles] = shape.radiosity ? shape.radiosityTiles : 0
  floats[at.firstClipmapRcp] = 1 / image.firstClipmapExtent
  floats[at.frustumDistance] = settings.surfaceCacheLightingMaxDistanceFromFrustumToPrioritize
  words[at.maxLights] = shape.maxLights
  floats[at.preExposure] = image.preExposure
  floats[at.shadowBias] = settings.surfaceCacheDirectLightingGlobalSdfShadowRayBias
  floats[at.maxTrace] = MAX_TRACE
  words[at.spacing] = shape.spacing
  words[at.spacingShift] = Math.log2(nextPow2(shape.spacing))
  words[at.hemisphere] = shape.hemisphere
  words[at.filterKernel] = settings.surfaceCacheRadiositySpatialFilterProbesKernelSize
  floats[at.planeDepthScale] = settings.surfaceCacheRadiosityProbePlaneWeightingDepthScale
  words[at.maxFrames] = settings.surfaceCacheRadiosityTemporal
    ? settings.surfaceCacheRadiosityTemporalMaxFramesAccumulated
    : 1
  ints[at.fixedJitter] = settings.surfaceCacheRadiosityTemporalFixedJitterIndex
  floats[at.maxRayIntensity] = settings.surfaceCacheRadiosityMaxRayIntensity / image.viewPreExposure
  floats[at.surfaceBias] = settings.surfaceCacheRadiosityDistanceFieldSurfaceSlopeBias
  floats[at.minTrace] = settings.surfaceCacheRadiosityDistanceFieldSurfaceBias
  for (let k = 0; k < 3; k++) {
    floats[at.camera + k] = image.eye[k] * CM
    floats[at.eye + k] = image.eye[k]
  }
  frustumPlanes(image.viewProjection, image.eye, floats, at.frustum)
}
