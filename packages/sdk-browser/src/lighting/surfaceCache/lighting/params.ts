import { ceilDiv, nextPow2 } from '../../../../../math/src/scalar/integers.ts'
import { length3 } from '../../../../../math/src/vector/vector.ts'
import { DISTANCE_FIELD_UNITS_PER_METRE as CM } from '../../../../../sdk-core/src/contracts/distanceFieldAbi.ts'
import type { SurfaceCacheSettings } from '../../../../../sdk-core/src/contracts/surfaceCacheOptions.ts'
import {
  hemisphereResolution,
  lightsPerTile,
  litTiles,
  probeSpacing,
  updateFrameFrozen,
  updateTilesOf,
} from '../../../../../sdk-core/src/lighting/surfaceCache/lightingMath.ts'
import { CARD_TILE_SIZE } from '../../../../../sdk-core/src/lighting/surfaceCache/cardResolution.ts'
import type { SceneTrace, SceneTraceWords } from '../../rays/sceneTrace/sceneTraceResources.ts'
import type { AtlasFormat } from '../../lightFunction/renderWgsl.ts'
import { contextLayout, LIGHTING_FLAG, LIGHTING_PARAMS, tracedShadowWords } from './layout.ts'

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
 * light tiles, none where only the radiosity is) their masks in `format` — with the scratch of the light functions where `scratch` —,
 * traces and light tiles (`tracedShadowWords`, the sizes they are made at).
 */
export function tracedRaysFit(
  limits: BufferLimits,
  lightTiles: number,
  scene: SceneTraceWords,
  format: AtlasFormat,
  scratch: boolean,
) {
  const most = Math.min(limits.maxStorageBufferBindingSize, limits.maxBufferSize)
  const shadows =
    lightTiles > 0 ? Object.values(tracedShadowWords(lightTiles, format, scratch)) : []
  return [...shadows, ...Object.values(scene)].every((words) => words * 4 <= most)
}

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
  /** Whether the radiosity keeps the distance each of its rays met a surface at, for the probes' occlusion (`probeOcclusionOf`). */
  readonly probeOcclusion: boolean
}

/**
 * The shape of the lighting of an atlas of `side` texels, `compressed` or not, under `settings`. It names nothing of the
 * traced shadows: their buffers are a set of their own (`ensureTracedShadows`), so that turning the traced path on or off
 * leaves the lighting's memory, and the radiosity's history, as they were.
 */
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
    depthRangeWords: shape.directTiles,
    tileLightsWords: shape.directTiles * (shape.maxLights + 1),
    filteredWords: shape.radiosity
      ? shape.radiosityTiles * shape.probesPerTile * shape.raysPerProbe
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
  readonly pages: number
  /** The eye, in metres, and the view's world-to-clip matrix. */
  readonly eye: ArrayLike<number>
  readonly viewProjection: ArrayLike<number>
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
  /** The word of the buffer the passes read the masks from where the scratch of the light functions begins (`standaloneScratchAt`):
   *  after the masks where the shadows are traced, 0 where the buffer holds the scratch alone. */
  readonly scratchAt: number
  /** The exposure of the view the lights are strengthened under (`lightStrength`): the last image's, as the CPU knows it. */
  readonly exposure: number
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

/** The flags word of an image: which of the lighting's passes and options are on. */
function lightingFlagsOf(
  shape: LightingShape,
  settings: SurfaceCacheSettings,
  image: LightingImage,
): number {
  return (
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
    (image.historyLost ? 0 : LIGHTING_FLAG.historyValid) |
    (updateFrameFrozen(settings) ? LIGHTING_FLAG.freezeUpdateFrame : 0) |
    (settings.surfaceCacheDirectLightingHardwareRayTracingAdaptiveShadowTracing
      ? LIGHTING_FLAG.adaptiveShadowTracing
      : 0) |
    (settings.surfaceCacheDirectLightingHardwareRayTracingForceTwoSided
      ? LIGHTING_FLAG.forceTwoSided
      : 0) |
    (image.feedback && settings.surfaceCacheLightingFeedback ? LIGHTING_FLAG.feedback : 0) |
    (settings.surfaceCacheDirectLightingCullToTileDepthRange
      ? LIGHTING_FLAG.cullToTileDepthRange
      : 0) |
    (shape.probeOcclusion && image.tracedRadiosity ? LIGHTING_FLAG.probeOcclusion : 0)
  )
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
  const flags = lightingFlagsOf(shape, settings, image)
  words.fill(0)
  words[at.atlasSide] = shape.side
  words[at.frame] = image.frame
  words[at.pages] = image.pages
  words[at.flags] = flags
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
  words[at.maxLights] = shape.maxLights
  floats[at.preExposure] = image.preExposure
  floats[at.shadowBias] = settings.surfaceCacheDirectLightingGlobalSdfShadowRayBias
  floats[at.maxTrace] = image.maxTraceDistance * CM
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
  words[at.scratchAt] = image.scratchAt
  floats[at.exposure] = image.exposure
  for (let k = 0; k < 3; k++) {
    floats[at.camera + k] = image.eye[k] * CM
    floats[at.eye + k] = image.eye[k]
  }
  frustumPlanes(image.viewProjection, image.eye, floats, at.frustum)
}
