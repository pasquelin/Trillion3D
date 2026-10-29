import { DEG2RAD } from '../../../../../math/src/constants.ts'
import { clamp } from '../../../../../math/src/scalar/reals.ts'
import { SCREEN_PROBE_CONSTANTS as C } from '../../../../../sdk-core/src/bounce/screenProbeLevels.ts'
import type { ScreenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { packDoubles } from '../../../../../math/src/float/splitDouble.ts'
import { putVec4 } from '../../../gpu/core/fieldLayout.ts'
import { wordViews } from '../../../gpu/core/wordViews.ts'
import { writeChanged } from '../../../gpu/core/writeChanged.ts'
import { SCREEN_PROBE_PARAMS as P, type ScreenProbeGeometry } from './screenProbeLayout.ts'
import { type ScreenProbeImage, screenProbeFlags } from './modeFlags.ts'

/** The most a ray's intensity may be held to: the composite quantises it to a whole number, so a larger bound would only coarsen the step. */
const MAX_RAY_INTENSITY_CEILING = 100000

/** The words of the parameters that are the image's and the probes' shapes: the size, the grid, the mode, the counts. */
function putWords(
  words: Uint32Array,
  geometry: ScreenProbeGeometry,
  settings: ScreenProbeSettings,
  image: ScreenProbeImage,
) {
  const at = P.at
  const { values } = settings
  // The passes drawn at the view's frame index take it. A fixed index moves three families apart, each with a word of `frames`:
  // the probes' gather state (the probes' screen trace, the short-range occlusion, the light's last blend: the fixed state frame index, over
  // which the stochastic lighting's wins), the probes' jitter (the fixed jitter index, else the stochastic lighting's, else the fixed state
  // frame index: also the tile jitter and the ray directions' turn) and the stochastic lighting's (the history test, the occlusion texel).
  const view = image.frame
  const { screenProbeFixedJitterIndex: jitterIndex, screenProbeFixedStateFrameIndex: stateIndex } =
    values
  const lighting = values.stochasticLightingFixedStateFrameIndex
  let fixed = lighting >= 0 ? lighting : stateIndex
  if (jitterIndex >= 0) fixed = jitterIndex
  const jitter = fixed >= 0 ? fixed : view
  putVec4(words, at.size, geometry.width, geometry.height, geometry.tile, view)
  putVec4(
    words,
    at.frames,
    lighting >= 0 ? lighting : stateIndex >= 0 ? stateIndex : view,
    jitter,
    lighting >= 0 ? lighting : view,
    values.screenProbeScreenTracesMinimumOccupancy,
  )
  putVec4(words, at.grid, geometry.tilesX, geometry.tilesY, geometry.rows, geometry.maxAdaptive)
  putVec4(
    words,
    at.mode,
    jitter % C.tileJitters,
    (fixed >= 0 ? fixed : image.previousFrame) % C.tileJitters,
    screenProbeFlags(settings, image),
    jitter % values.screenProbeMaxRayDirections,
  )
  putVec4(
    words,
    at.counts,
    settings.maxFramesAccumulated,
    geometry.uniform,
    values.screenProbeMaxIterations,
    geometry.gather,
  )
}

/** The numbers of the parameters the settings give: the weights, the filter's, the occlusion's and the scene trace's. */
function putWeights(staged: Float32Array, settings: ScreenProbeSettings) {
  const at = P.at
  const { values: v } = settings
  putVec4(
    staged,
    at.weights,
    C.depthWeightScale * v.screenProbeInterpolationDepthWeight,
    C.depthWeightScale * v.screenProbeInterpolationDepthWeightFallback,
    v.screenProbeMinPdfToTrace,
    Math.min(v.screenProbeMaxRayIntensity, MAX_RAY_INTENSITY_CEILING),
  )
  putVec4(
    staged,
    at.spatial,
    v.screenProbeSpatialFilterPositionWeightScale,
    v.screenProbeSpatialFilterMaxHitAngle * DEG2RAD,
    settings.jitterWidth,
    v.screenProbeMaxTraceDistance,
  )
  putVec4(
    staged,
    at.occlusion,
    settings.occlusionSlices,
    v.screenProbeOcclusionSteps,
    v.screenProbeOcclusionForegroundFraction,
    v.screenProbeOcclusionClampScale,
  )
  staged[at.scene] = v.screenProbeSurfaceBias
  staged[at.scene + 1] = v.screenProbeHistoryDistanceThreshold
  staged[at.scene + 2] = Math.cos(v.screenProbeNormalThreshold * DEG2RAD)
  staged[at.scene + 3] = v.screenProbeHistoryDistanceThresholdForFoliage
}

/** The numbers of the parameters the settings give: the radiance cache's, the motion's and the thicknesses'. */
function putMotion(staged: Float32Array, settings: ScreenProbeSettings, image: ScreenProbeImage) {
  const at = P.at
  const { values: v } = settings
  putVec4(
    staged,
    at.cache,
    v.screenProbeRadianceCacheReprojectionRadiusScale,
    settings.cache.resolution,
    settings.cache.mipmaps,
    1 / Math.min(v.screenProbeFullSkylightLeakingDistance, v.screenProbeMaxTraceDistance),
  )
  putVec4(
    staged,
    at.motion,
    v.screenProbeRelativeSpeedThreshold,
    settings.fastUpdateInverseFraction,
    v.screenProbeMaxFastUpdate,
    v.screenProbeMinTraceDistance,
  )
  putVec4(
    staged,
    at.tuning,
    v.screenProbeDisocclusionMaxFrames,
    v.screenProbeDisocclusionFraction,
    image.historyThickness,
    image.relativeThickness,
  )
  putVec4(
    staged,
    at.trace,
    image.rays ? 1 : v.screenProbeThicknessScaleWithoutField,
    settings.thicknessCertaintySteps,
    v.screenProbeMaxRoughnessToEvaluateRoughSpecular,
    image.roughSpecularFoliage,
  )
  putVec4(
    staged,
    at.foliage,
    settings.occlusionFoliageStrength,
    v.screenProbeOcclusionIntensity,
    C.depthWeightScale * v.screenProbeInterpolationDepthWeightForFoliage,
    v.screenProbeOcclusionMaxAlbedo,
  )
  putVec4(
    staged,
    at.screen,
    v.screenProbeScreenTracesHairBias,
    v.screenProbeTemporalFilterProbesHistoryWeight,
    v.screenProbeExtraAmbientOcclusionMaxDistance,
    v.screenProbeExtraAmbientOcclusionExponent,
  )
  const [red, green, blue] = image.skylightLeak
  putVec4(staged, at.leak, red, green, blue, v.screenProbeSkylightLeakingRoughness)
}

/** The numbers of the rays cast through the scene's triangles: the biases, the pull-back, and what the scene trace the image holds says of a hit
 *  (`image.rays`, centimetres and metres) and of the way a ray avoids the geometry it starts on; zero where the image holds none. */
function putTraced(staged: Float32Array, settings: ScreenProbeSettings, image: ScreenProbeImage) {
  const at = P.at
  const { values: v } = settings
  const { rays } = image
  putVec4(
    staged,
    at.traced,
    v.screenProbeHardwareRayTracingBias,
    v.screenProbeHardwareRayTracingNormalBias,
    v.screenProbeHardwareRayTracingHairBias,
    v.hardwareRayTracingPullbackBias,
  )
  putVec4(
    staged,
    at.tracedHit,
    rays?.depthBias ?? 0,
    rays?.minHitDistance ?? 0,
    rays?.selfIntersections ?? 0,
  )
  putVec4(staged, at.projection, image.depthThicknessScale, 0, 0, 0)
}

/** The short-range global illumination's numbers: its furthest reach as a share of the image's width (the reference's fraction of the screen, never under the occlusion's two tiles, never over
 *  one) and the steps a slice takes to reach it (the occlusion's, over the square root of the two reaches). */
function putGi(staged: Float32Array, geometry: ScreenProbeGeometry, settings: ScreenProbeSettings) {
  const { values: v } = settings
  const aoFraction = (2 * geometry.tile) / geometry.width
  const fraction = clamp(v.screenProbeShortRangeGIMaxScreenFraction, aoFraction, 1)
  putVec4(
    staged,
    P.at.gi,
    fraction,
    Math.ceil(v.screenProbeOcclusionSteps * Math.sqrt(fraction / aoFraction)),
    v.screenProbeShortRangeGIMaxRayIntensity,
    v.screenProbeShortRangeGIHistoryDepthTestRelativeThickness,
  )
}

/**
 * The writer of the parameters' uniform: the image's size, tile and rank; the probes' shapes; the mode (this
 * image's tile jitter and the last's, the flags, the ray directions' turn); the history's longest, the uniform probes,
 * the screen trace's iterations and the texels a side of the gather; the weights of the interpolation (the plane's depth weight and the
 * fallback's, in the exponent, the foliage's with the foliage numbers), the probability under which a ray is not drawn and the intensity a ray is held to; the
 * filter's numbers, the jitter of the probes a pixel reads and the furthest a ray looks; the occlusion's search; the scene
 * trace's and the history's numbers, the radiance cache's, the motion's numbers; the disocclusion's and the screen trace's thicknesses and the roughnesses of the rough specular and the foliage's occlusion strength; the last
 * view-projection's inverse and the eye's doubles; the rays cast through the scene's triangles' numbers. The words that differ from those it sent go up (`writeChanged`); nothing is allocated by a call.
 */
export function createScreenProbeParams(device: GPUDevice, buffer: GPUBuffer) {
  const { f: staged, u: words } = wordViews(new ArrayBuffer(P.words * 4))
  return (
    geometry: ScreenProbeGeometry,
    settings: ScreenProbeSettings,
    image: ScreenProbeImage,
  ) => {
    putWords(words, geometry, settings, image)
    putWeights(staged, settings)
    putMotion(staged, settings, image)
    putTraced(staged, settings, image)
    putGi(staged, geometry, settings)
    staged.set(image.previousInverse, P.at.previous)
    packDoubles(words, P.at.eyeXY, image.eye)
    writeChanged(device, buffer, words, 0, P.words)
  }
}
