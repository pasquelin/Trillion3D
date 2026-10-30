import { storageBufferCap } from '../../../session/memory/pools.ts'
import { ceilDiv, nextPow2 } from '../../../../../math/src/scalar/integers.ts'
import { length3 } from '../../../../../math/src/vector/vector.ts'
import { DISTANCE_FIELD_UNITS_PER_METRE as CM } from '../../../../../sdk-core/src/contracts/distanceFieldAbi.ts'
import type { SurfaceCacheSettings } from '../../../../../sdk-core/src/contracts/surfaceCacheOptions.ts'
import {
  hemisphereResolution,
  lightsPerTile,
  lightTilesPerType,
  litTiles,
  probeSpacing,
  updateFrameFrozen,
  updateTilesOf,
} from '../../../../../sdk-core/src/lighting/surfaceCache/lightingMath.ts'
import { CARD_TILE_SIZE } from '../../../../../sdk-core/src/lighting/surfaceCache/cardResolution.ts'
import type { SceneTrace, SceneTraceWords } from '../../rays/sceneTrace/sceneTraceResources.ts'
import type { AtlasFormat } from '../../lightFunction/renderWgsl.ts'
import type { LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import { lightWordsOf } from '../../../gpu/core/lightWords.ts'
import {
  CARD_TILE_OFFSET_WORDS,
  contextLayout,
  LIGHT_TILE_WORDS,
  LIGHTING_FLAG,
  LIGHTING_PARAMS,
  tracedShadowWords,
} from './layout.ts'

/**
 * WHAT AN IMAGE'S LIGHTING IS SIZED BY, and the parameters written from it (`LIGHTING_PARAMS`): the settings' numbers made
 * what the kernels read — the tiles each update lights, the lists' capacities and places, the radiosity's spacing and
 * hemisphere —, the frustum the pages' priority is measured against, and the eye. `shapeOf` is what the resources and the
 * programs are made for (`shapeKey` says when they must be made again); `writeLightingParams` is the image's.
 */

/** The limits of the device that decide whether the traced rays' buffers fit: the most a storage buffer binds and a buffer holds. */
export type BufferLimits = Pick<GPUSupportedLimits, 'maxStorageBufferBindingSize' | 'maxBufferSize'>

/**
 * Whether every buffer of the rays through the scene's triangles fits a binding and a buffer of `limits`: the scene trace's
 * nodes, triangles and table of placements (`scene`, `sceneTraceWords`), and where the shadows are traced (`lightTiles`
 * light tiles, none where only the radiosity is) their masks in `format`,
 * traces and light tiles (`tracedShadowWords`, the sizes they are made at).
 */
export function tracedRaysFit(
  limits: BufferLimits,
  lightTiles: number,
  scene: SceneTraceWords,
  format: AtlasFormat,
) {
  const most = storageBufferCap(limits)
  const shadows = lightTiles > 0 ? Object.values(tracedShadowWords(lightTiles, format)) : []
  return [...shadows, ...Object.values(scene)].every((words) => words * 4 <= most)
}

/** What the lighting's resources and programs are made for. */
export interface LightingShape {
  readonly side: number
  readonly compressed: boolean
  /** The format the atlas's light, and the radiosity's rays', are stored in. */
  readonly light: LightAtlasFormat
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
  /** Whether the radiosity keeps the distance each of its rays met a surface at, for the probes' occlusion (`probeOcclusionOf`). */
  readonly probeOcclusion: boolean
}

/**
 * The shape of the lighting of an atlas of `side` texels, `compressed` or not, its light stored in `light`, under `settings`. It names nothing of the
 * traced shadows: their buffers are a set of their own (`ensureTracedShadows`), so that turning the traced path on or off
 * leaves the lighting's memory, and the radiosity's history, as they were.
 */
export function shapeOf(
  settings: SurfaceCacheSettings,
  side: number,
  compressed: boolean,
  light: LightAtlasFormat,
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
    light,
    directTiles: tiles.direct,
    indirectTiles: tiles.indirect,
    maxLights: lightsPerTile(settings.surfaceCacheDirectLightingMaxLightsPerTile),
    radiosity: settings.surfaceCacheRadiosity,
    spacing,
    hemisphere,
    radiosityTiles: tiles.indirect * along * along,
    probesPerTile: (tileSize / spacing) ** 2,
    raysPerProbe: hemisphere * hemisphere,
    probeOcclusion: probeOcclusionOf(settings),
  }
}

/** The strength of the probes' occlusion, held from 0 to 1. */
const probeOcclusionStrength = (settings: SurfaceCacheSettings) =>
  Math.min(Math.max(settings.surfaceCacheRadiosityProbeOcclusionStrength, 0), 1)

/** Whether the probes' occlusion is asked for: it is on, with a strength over 0, for the radiosity's rays through the scene's triangles
 *  (the rays marched through the field are too imprecise to tell the distance of a hit). */
const probeOcclusionOf = (settings: SurfaceCacheSettings) =>
  settings.surfaceCacheRadiosity &&
  settings.surfaceCacheRadiosityHardwareRayTracing &&
  settings.surfaceCacheRadiosityProbeOcclusion &&
  probeOcclusionStrength(settings) > 0

/** The shape as a key: two images with the same key use the same resources and programs. */
export const shapeKey = (shape: LightingShape) => JSON.stringify(shape)

/** The words of the context's buffer, the light tiles' lists and the filtered rays of a shape, and its probes' atlas sizes. The light
 *  tiles of the direct list are at most `maxLights` a tile: the culled, the compacted and the tiles' own lists hold as many. */
export function sizesOf(shape: LightingShape) {
  const context = contextLayout(
    shape.directTiles,
    shape.indirectTiles,
    shape.radiosity ? shape.radiosityTiles : 0,
  )
  const probes = ceilDiv(shape.side, shape.spacing)
  return {
    context,
    depthRangeWords: shape.directTiles,
    lightTileWords: shape.directTiles * shape.maxLights * LIGHT_TILE_WORDS,
    cardTileOffsetWords: shape.directTiles * CARD_TILE_OFFSET_WORDS,
    filteredWords: shape.radiosity
      ? shape.radiosityTiles * shape.probesPerTile * shape.raysPerProbe * lightWordsOf(shape.light)
      : 1,
    probeAtlas: shape.radiosity ? probes : 1,
    traceAtlas: shape.radiosity ? probes * shape.hemisphere : 1,
    hitAtlas: shape.probeOcclusion ? probes * shape.hemisphere : 1,
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
  /** The noise's clock (`noiseFrame`): the dither of the cache's output turns on it, never on the update clock `frame`. */
  readonly noiseFrame: number
  readonly pages: number
  /** The eye, in metres, and the view's world-to-clip matrix. */
  readonly eye: ArrayLike<number>
  readonly viewProjection: ArrayLike<number>
  /** The second view the cache keeps cards for, if any (`LUMEN_MAX_VIEWS` of the reference is two): its eye, in metres, and
   *  its world-to-clip matrix. The pages' priority is the nearer of the two views' and prioritises a page near either's frustum. */
  readonly other?: { readonly eye: ArrayLike<number>; readonly viewProjection: ArrayLike<number> }
  /** The number the light is kept multiplied by, and the view's pre-exposure. */
  readonly preExposure: number
  readonly viewPreExposure: number
  /** The first clipmap's half side of the global field, in centimetres. */
  readonly firstClipmapExtent: number
  /** The longest a ray of the lighting travels, in metres: the furthest the view's rays look for a surface (`screenProbeMaxTraceDistance`). */
  readonly maxTraceDistance: number
  /** Whether the radiosity's history was lost since the last image. */
  readonly historyLost: boolean
  /** Whether the rays' feedback can prioritise the pages: the feedback's buffer is made and the scene has acceleration
   *  structures, whichever of the rays are cast through them. It does where `surfaceCacheLightingFeedback` is on. */
  readonly feedback: boolean
  /** Whether the image's radiosity rays go through the scene's triangles, which write the distances the probes' occlusion reads. */
  readonly tracedRadiosity: boolean
  /** Whether the image's shadows are traced through the distance fields: the masks list no trace, and none answers a quad of four texels, the adaptive tracing being the scene's triangles'. */
  readonly fieldShadows?: boolean
  /** The exposure of the view the lights are strengthened under (`lightStrength`): the last image's, as the CPU knows it. */
  readonly exposure: number
  /** Whether the image lights its texels from the lights it picks for each (`surfaceCacheDirectLightingStochastic`, with its shadows traced), and whether
   *  the history it blends them with was kept since the last image. */
  readonly stochastic?: boolean
  readonly stochasticHistory?: boolean
}

/** The lights picked for each texel: the setting, 3 taken as 4. */
export const stochasticSamplesOf = (
  settings: Pick<SurfaceCacheSettings, 'surfaceCacheDirectLightingStochasticSamplePerTexel'>,
) => {
  const samples = settings.surfaceCacheDirectLightingStochasticSamplePerTexel
  return samples > 2 ? 4 : samples
}

/** Whether the image's rays write the feedback: its buffer is made and the scene has acceleration structures — the scene's
 *  hardware ray tracing as a whole, whichever of the lighting's own rays go through them. */
export const feedbackWritten = (buffer: GPUBuffer | undefined, rayTracing: object | undefined) =>
  buffer !== undefined && !!rayTracing

/** The scene trace's view of this image (`SceneTrace.writeParams`): the eye, the cut's tree top, the bounds of a trace and the culling of the
 *  placements, from the settings (centimetres taken to metres), the direction the camera looks along and the instances' draw
 *  distances as the cut tests them: their scale (`viewDistanceFactor`) and whether they are tested (`cutDrawDistanceCulling`). */
export function traceViewOf(
  settings: SurfaceCacheSettings,
  eye: ArrayLike<number>,
  direction: readonly [number, number, number],
  treeRoot: number,
  instances: { readonly scale: number; readonly culled: boolean },
): Parameters<SceneTrace['writeParams']>[0] {
  return {
    eye: [eye[0], eye[1], eye[2]],
    treeRoot,
    maxIterations: settings.surfaceCacheHardwareRayTracingMaxIterations,
    skipBackFaceDistance: settings.surfaceCacheHardwareRayTracingSkipBackFaceHitDistance / CM,
    skipTwoSidedDistance: settings.surfaceCacheHardwareRayTracingSkipTwoSidedHitDistance / CM,
    skipsTranslucentSections: settings.surfaceCacheHardwareRayTracingMeshSectionVisibilityTest,
    excludesSky: settings.rayTracingExcludeSky,
    culling: {
      mode: settings.rayTracingCulling,
      radius: settings.rayTracingCullingRadius / CM,
      angle: settings.rayTracingCullingAngle,
      useDistanceToBox: settings.rayTracingCullingUseDistanceToBox,
      useMinDrawDistance: settings.rayTracingCullingUseMinDrawDistance,
      direction: [direction[0], direction[1], direction[2]],
      viewDistanceScale: instances.scale,
      instanceDrawDistance: instances.culled,
    },
  }
}

/** The flags of the direct light and of what prioritises the cards' updates. */
function directFlagsOf(settings: SurfaceCacheSettings, image: LightingImage) {
  return (
    (settings.surfaceCacheDirectLighting ? LIGHTING_FLAG.direct : 0) |
    (settings.surfaceCacheLightingMaxDistanceFromFrustumToPrioritize >= 0
      ? LIGHTING_FLAG.prioritizeFrustum
      : 0) |
    (updateFrameFrozen(settings) ? LIGHTING_FLAG.freezeUpdateFrame : 0) |
    (settings.surfaceCacheDirectLightingHardwareRayTracingAdaptiveShadowTracing &&
    !image.fieldShadows
      ? LIGHTING_FLAG.adaptiveShadowTracing
      : 0) |
    (image.fieldShadows ? LIGHTING_FLAG.fieldShadows : 0) |
    (settings.surfaceCacheDirectLightingHardwareRayTracingForceTwoSided
      ? LIGHTING_FLAG.forceTwoSided
      : 0) |
    (image.feedback && settings.surfaceCacheLightingFeedback ? LIGHTING_FLAG.feedback : 0) |
    (settings.surfaceCacheDirectLightingCullToTileDepthRange
      ? LIGHTING_FLAG.cullToTileDepthRange
      : 0) |
    (lightTilesPerType(settings.surfaceCacheDirectLightingBatchShadows)
      ? LIGHTING_FLAG.lightTilesPerType
      : 0)
  )
}

/** The flags of the radiosity and of the history it blends. */
function radiosityFlagsOf(
  shape: LightingShape,
  settings: SurfaceCacheSettings,
  image: LightingImage,
) {
  return (
    (shape.radiosity ? LIGHTING_FLAG.radiosity : 0) |
    (settings.surfaceCacheRadiositySpatialFilterProbes &&
    settings.surfaceCacheRadiositySpatialFilterProbesKernelSize > 0
      ? LIGHTING_FLAG.filter
      : 0) |
    (settings.surfaceCacheRadiosityTemporal ? LIGHTING_FLAG.temporal : 0) |
    (settings.surfaceCacheRadiosityProbePlaneWeighting ? LIGHTING_FLAG.planeWeighting : 0) |
    (image.historyLost ? 0 : LIGHTING_FLAG.historyValid) |
    (shape.probeOcclusion && image.tracedRadiosity ? LIGHTING_FLAG.probeOcclusion : 0)
  )
}

/** The flags of the stochastic direct light. */
function stochasticFlagsOf(settings: SurfaceCacheSettings, image: LightingImage) {
  return (
    (image.stochastic ? LIGHTING_FLAG.stochastic : 0) |
    (image.stochastic && settings.surfaceCacheDirectLightingStochasticTemporal
      ? LIGHTING_FLAG.stochasticTemporal
      : 0) |
    (image.stochastic && image.stochasticHistory ? LIGHTING_FLAG.stochasticHistory : 0)
  )
}

/** The flags word of an image: which of the lighting's passes and options are on. */
function lightingFlagsOf(
  shape: LightingShape,
  settings: SurfaceCacheSettings,
  image: LightingImage,
): number {
  return (
    directFlagsOf(settings, image) |
    radiosityFlagsOf(shape, settings, image) |
    stochasticFlagsOf(settings, image)
  )
}

/** The views of an image's parameters: its words, as floats and as integers. */
interface ParamViews {
  readonly words: Uint32Array
  readonly floats: Float32Array
  readonly ints: Int32Array
}

/** The sizes, the update lists and the exposure of an image's parameters. */
function writeLightingLayout(
  { words, floats }: ParamViews,
  shape: LightingShape,
  settings: SurfaceCacheSettings,
  image: LightingImage,
) {
  const at = LIGHTING_PARAMS.at
  const { context } = sizesOf(shape)
  words[at.atlasSide] = shape.side
  words[at.frame] = image.frame
  words[at.noiseFrame] = image.noiseFrame
  words[at.pages] = image.pages
  words[at.flags] = lightingFlagsOf(shape, settings, image)
  words[at.directTiles] = litTiles(settings, shape.directTiles)
  words[at.indirectTiles] = litTiles(settings, shape.indirectTiles)
  words[at.directAt] = context.directAt
  words[at.indirectAt] = context.indirectAt
  words[at.radiosityAt] = context.radiosityAt
  words[at.directPagesAt] = context.directPagesAt
  words[at.indirectPagesAt] = context.indirectPagesAt
  words[at.radiosityTiles] = shape.radiosity ? shape.radiosityTiles : 0
  floats[at.firstClipmapRcp] = 1 / image.firstClipmapExtent
  floats[at.frustumDistance] = settings.surfaceCacheLightingMaxDistanceFromFrustumToPrioritize
  floats[at.preExposure] = image.preExposure
  floats[at.shadowBias] = settings.surfaceCacheDirectLightingGlobalSdfShadowRayBias
  floats[at.maxTrace] = image.maxTraceDistance * CM
}

/** The radiosity's probes, filter, accumulation and biases of an image's parameters. */
function writeLightingRadiosity(
  { words, floats, ints }: ParamViews,
  shape: LightingShape,
  settings: SurfaceCacheSettings,
  image: LightingImage,
) {
  const at = LIGHTING_PARAMS.at
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
  floats[at.traceRayBias] = settings.surfaceCacheDirectLightingHardwareRayTracingShadowRayBias
  floats[at.traceEndBias] = settings.surfaceCacheDirectLightingHardwareRayTracingEndBias
  floats[at.radiosityRayBias] = settings.surfaceCacheRadiosityHardwareRayTracingBias
  floats[at.radiosityNormalBias] = settings.surfaceCacheRadiosityHardwareRayTracingNormalBias
  floats[at.cardDepthBias] = settings.surfaceCacheHardwareRayTracingSurfaceCacheSamplingDepthBias
  floats[at.cardMinDistance] =
    settings.surfaceCacheHardwareRayTracingMinTraceDistanceToSampleSurfaceCache
  words[at.selfIntersections] = settings.surfaceCacheHardwareRayTracingAvoidSelfIntersections
  floats[at.probeOcclusionStrength] = probeOcclusionStrength(settings)
}

/** Writes the parameters of an image into `words`, `LIGHTING_PARAMS.words` long. */
export function writeLightingParams(
  words: Uint32Array,
  shape: LightingShape,
  settings: SurfaceCacheSettings,
  image: LightingImage,
) {
  const views = {
    words,
    floats: new Float32Array(words.buffer, words.byteOffset, words.length),
    ints: new Int32Array(words.buffer, words.byteOffset, words.length),
  }
  const { floats } = views
  const at = LIGHTING_PARAMS.at
  words.fill(0)
  writeLightingLayout(views, shape, settings, image)
  writeLightingRadiosity(views, shape, settings, image)
  floats[at.exposure] = image.exposure
  words[at.stochasticSamples] = stochasticSamplesOf(settings)
  floats[at.stochasticMinWeight] = settings.surfaceCacheDirectLightingStochasticMinWeight
  floats[at.stochasticMaxFrames] =
    settings.surfaceCacheDirectLightingStochasticTemporalMaxFramesAccumulated
  floats[at.stochasticClampScale] =
    settings.surfaceCacheDirectLightingStochasticTemporalNeighborhoodClampScale
  for (let k = 0; k < 3; k++) {
    floats[at.camera + k] = image.eye[k] * CM
    floats[at.eye + k] = image.eye[k]
  }
  frustumPlanes(image.viewProjection, image.eye, floats, at.frustum)
  if (!image.other) return
  for (let k = 0; k < 3; k++) floats[at.otherEye + k] = image.other.eye[k] * CM
  floats[at.otherEye + 3] = 1
  frustumPlanes(image.other.viewProjection, image.other.eye, floats, at.otherFrustum)
}
