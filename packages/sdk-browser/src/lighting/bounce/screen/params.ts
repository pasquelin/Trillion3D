import { DEG2RAD } from '../../../../../math/src/constants.ts'
import { SCREEN_PROBE_CONSTANTS as C } from '../../../../../sdk-core/src/bounce/screenProbeLevels.ts'
import type { ScreenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { putVec4 } from '../../../gpu/core/fieldLayout.ts'
import { wordViews } from '../../../gpu/core/wordViews.ts'
import { writeChanged } from '../../../gpu/core/writeChanged.ts'
import { SCREEN_PROBE_PARAMS as P, type ScreenProbeGeometry } from './screenProbeLayout.ts'
import { type ScreenProbeImage, screenProbeFlags } from './modeFlags.ts'

/** The words of the parameters that are the image's and the probes' shapes: the size, the grid, the mode, the counts. */
function putWords(
  words: Uint32Array,
  geometry: ScreenProbeGeometry,
  settings: ScreenProbeSettings,
  image: ScreenProbeImage,
) {
  const at = P.at
  const { values } = settings
  putVec4(words, at.size, geometry.width, geometry.height, geometry.tile, image.frame >>> 0)
  putVec4(words, at.grid, geometry.tilesX, geometry.tilesY, geometry.rows, geometry.maxAdaptive)
  putVec4(
    words,
    at.mode,
    image.frame % C.tileJitters,
    image.previousFrame % C.tileJitters,
    screenProbeFlags(settings, image),
    image.frame % values.screenProbeMaxRayDirections,
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
    v.screenProbeMaxRayIntensity,
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
    v.screenProbeHistoryDepthTestThickness,
    image.relativeThickness,
  )
  putVec4(
    staged,
    at.trace,
    v.screenProbeThicknessScaleWithoutField,
    settings.thicknessCertaintySteps,
    v.screenProbeMaxRoughnessToEvaluateRoughSpecular,
    v.screenProbeMaxRoughnessToEvaluateRoughSpecularForFoliage,
  )
  putVec4(
    staged,
    at.foliage,
    v.screenProbeOcclusionFoliageStrength,
    v.screenProbeOcclusionIntensity,
    0,
    0,
  )
}

/**
 * The writer of the parameters' uniform: the image's size, tile and rank; the probes' shapes; the mode (this
 * image's tile jitter and the last's, the flags, the ray directions' turn); the history's longest, the uniform probes,
 * the screen trace's iterations and the texels a side of the gather; the weights of the interpolation (the plane's depth weight and the
 * fallback's, in the exponent), the probability under which a ray is not drawn and the intensity a ray is held to; the
 * filter's numbers, the jitter of the probes a pixel reads and the furthest a ray looks; the occlusion's search; the scene
 * trace's and the history's numbers, the radiance cache's, the motion's numbers; the disocclusion's and the screen trace's thicknesses and the roughnesses of the rough specular and the foliage's occlusion strength; the last
 * view-projection's inverse. The words that differ from those it sent go up (`writeChanged`); nothing is allocated by a call.
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
    staged.set(image.previousInverse, P.at.previous)
    writeChanged(device, buffer, words, 0, P.words)
  }
}
