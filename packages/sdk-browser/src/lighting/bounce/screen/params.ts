import { DEG2RAD } from '../../../../../math/src/constants.ts'
import { SCREEN_PROBE_CONSTANTS as C } from '../../../../../sdk-core/src/bounce/screenProbeLevels.ts'
import type { ScreenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { putVec4 } from '../../../gpu/core/fieldLayout.ts'
import { wordViews } from '../../../gpu/core/wordViews.ts'
import { writeChanged } from '../../../gpu/core/writeChanged.ts'
import {
  SCREEN_PROBE_FLAGS as F,
  SCREEN_PROBE_PARAMS as P,
  type ScreenProbeGeometry,
} from './screenProbeLayout.ts'

/** What an image tells its kernels beside its settings and its probes' shapes: its rank, and what
 *  this image has to read. */
interface ScreenProbeImage {
  /** The image's rank in the view's sequence: its tile jitter, its ray directions' turn, its noise. */
  frame: number
  /** The last image's history is there to read (its view-projection is the one the reflection's radiance holds). */
  history: boolean
  /** The screen is traced (the depth and the last lit image are there). */
  screen: boolean
  /** The radiance cache exists (the world's probes' maps), and the view reads it: `screenProbeRadianceCache` over a level that casts. */
  cache: boolean
  /** The surfaces' vectors of this image are there to read (the velocity stage drew them). */
  velocity: boolean
  /** The inverse of the view-projection the last lit image was drawn with, 16 elements. */
  previousInverse: ArrayLike<number>
  /** The relative thickness the screen trace gives a surface, times the projection's depth scale
   *  (`screenRelativeThickness`). */
  relativeThickness: number
  /** Whether the trace's march goes down to the full-resolution depth (`hizFullResDepth`). */
  fullResDepth: boolean
}

/** Whether a flag is set: its bit, or none. */
const bit = (on: boolean, flag: number) => (on ? flag : 0)

/** The mode word's flags of an image at `settings`: each bit its meaning (`SCREEN_PROBE_FLAGS`). */
export function screenProbeFlags(settings: ScreenProbeSettings, image: ScreenProbeImage) {
  const { values } = settings
  const sampled = values.screenProbeImportanceSampling
  return (
    bit(image.screen && values.screenProbeScreenTraces, F.screenTraces) |
    bit(sampled, F.importance) |
    bit(sampled && settings.importanceLighting, F.importanceLighting) |
    bit(sampled && image.history && values.screenProbeProbeRadianceHistory, F.radianceHistory) |
    bit(image.history && values.screenProbeTemporal, F.temporal) |
    bit(settings.stochasticInterpolation, F.stochastic) |
    bit(image.cache, F.cache) |
    bit(settings.irradianceFormat === 'octahedral', F.octahedral) |
    bit(settings.occlusion, F.occlusion) |
    bit(values.screenProbeSceneTraces, F.sceneTraces) |
    bit(values.screenProbeSceneTraces && settings.meshTraces, F.meshTraces) |
    bit(image.history && image.velocity, F.velocity) |
    bit(values.screenProbeFastUpdateClamp, F.fastUpdateClamp) |
    bit(values.screenProbeDisocclusionMaxFrames > 0, F.disocclusion) |
    bit(values.screenProbeOcclusionTemporal, F.occlusionTemporal) |
    bit(image.fullResDepth, F.fullResDepth) |
    bit(values.screenProbeSkipFoliageHits, F.skipFoliageHits)
  )
}

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
    (image.frame + C.tileJitters - 1) % C.tileJitters,
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

/** The numbers of the parameters the settings give: the weights, the filter's, the occlusion's, the scene trace's, the motion's and the thicknesses'. */
function putNumbers(staged: Float32Array, settings: ScreenProbeSettings, image: ScreenProbeImage) {
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
  putVec4(
    staged,
    at.scene,
    v.screenProbeMeshTraceDistance,
    v.screenProbeMeshTraceEndDistance,
    v.screenProbeSurfaceBias,
    v.screenProbeHistoryDistanceThreshold,
  )
  putVec4(
    staged,
    at.cache,
    v.screenProbeRadianceCacheReprojectionRadiusScale,
    settings.cache.resolution,
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
 * trace's and the history's numbers, the radiance cache's, the motion's numbers; the disocclusion's and the screen trace's thicknesses; the last
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
    putNumbers(staged, settings, image)
    staged.set(image.previousInverse, P.at.previous)
    writeChanged(device, buffer, words, 0, P.words)
  }
}
