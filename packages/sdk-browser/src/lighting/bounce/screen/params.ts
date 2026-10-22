import { DEG2RAD } from '../../../../../math/src/constants.ts'
import { SCREEN_PROBE_CONSTANTS as C } from '../../../../../sdk-core/src/bounce/screenProbeLevels.ts'
import type { ScreenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
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
  /** The field of the world's probes exists. */
  field: boolean
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
  const sampled = settings.importanceSampling
  return (
    bit(image.screen && settings.screenTraces, F.screenTraces) |
    bit(sampled, F.importance) |
    bit(sampled && settings.importanceLighting, F.importanceLighting) |
    bit(sampled && image.history && settings.radianceHistory, F.radianceHistory) |
    bit(image.history && settings.temporal, F.temporal) |
    bit(settings.stochasticInterpolation, F.stochastic) |
    bit(image.field, F.field) |
    bit(settings.irradianceFormat === 'octahedral', F.octahedral) |
    bit(settings.occlusion, F.occlusion) |
    bit(settings.sceneTraces, F.sceneTraces) |
    bit(settings.sceneTraces && settings.meshTraces, F.meshTraces) |
    bit(image.history && image.velocity, F.velocity) |
    bit(settings.fastUpdateClamp, F.fastUpdateClamp) |
    bit(image.fullResDepth, F.fullResDepth) |
    bit(settings.skipFoliageHits, F.skipFoliageHits)
  )
}

/** Writes the four numbers `a, b, c, d` at word `at`. */
function put(
  into: ArrayLike<number> & { [index: number]: number },
  at: number,
  a: number,
  b: number,
  c: number,
  d: number,
) {
  into[at] = a
  into[at + 1] = b
  into[at + 2] = c
  into[at + 3] = d
}

/** The words of the parameters that are the image's and the probes' shapes: the size, the grid, the mode, the counts. */
function putWords(
  words: Uint32Array,
  geometry: ScreenProbeGeometry,
  settings: ScreenProbeSettings,
  image: ScreenProbeImage,
) {
  const at = P.at
  put(words, at.size, geometry.width, geometry.height, geometry.tile, image.frame >>> 0)
  put(words, at.grid, geometry.tilesX, geometry.tilesY, geometry.rows, geometry.maxAdaptive)
  put(
    words,
    at.mode,
    image.frame % C.tileJitters,
    (image.frame + C.tileJitters - 1) % C.tileJitters,
    screenProbeFlags(settings, image),
    image.frame % C.rayDirections,
  )
  put(
    words,
    at.counts,
    settings.maxFramesAccumulated,
    geometry.uniform,
    settings.maxIterations,
    geometry.tracing,
  )
}

/** The numbers of the parameters the settings give: the weights, the filter's, the scene trace's, the motion's and the thicknesses'. */
function putNumbers(staged: Float32Array, settings: ScreenProbeSettings, image: ScreenProbeImage) {
  const at = P.at
  const weights = [C.interpolationDepthWeight, C.interpolationDepthWeightFallback]
  put(
    staged,
    at.weights,
    C.depthWeightScale * weights[0],
    C.depthWeightScale * weights[1],
    settings.minPdfToTrace,
    settings.maxRayIntensity,
  )
  put(
    staged,
    at.spatial,
    settings.filterPositionWeightScale,
    settings.filterHitAngleDegrees * DEG2RAD,
    settings.jitterWidth,
    settings.occlusionIntensity,
  )
  put(
    staged,
    at.scene,
    settings.meshTraceDistance,
    settings.meshTraceEndDistance,
    settings.surfaceBias,
    settings.historyDistanceThreshold,
  )
  put(
    staged,
    at.motion,
    settings.relativeSpeedThreshold,
    settings.fastUpdateInverseFraction,
    settings.maxFastUpdate,
    0,
  )
  put(
    staged,
    at.tuning,
    settings.disocclusionMaxFrames,
    settings.disocclusionFraction,
    settings.traceHistoryThickness,
    image.relativeThickness,
  )
  put(staged, at.trace, settings.thicknessScaleWithoutField, settings.thicknessCertaintySteps, 0, 0)
}

/**
 * The writer of the parameters' uniform: the image's size, tile and rank; the probes' shapes; the mode (this
 * image's tile jitter and the last's, the flags, the ray directions' turn); the history's longest, the uniform probes,
 * the screen trace's iterations and the rays a side; the weights of the interpolation (the plane's depth weight and the
 * fallback's, in the exponent), the probability under which a ray is not drawn and the intensity a ray is held to; the
 * filter's numbers and the jitter of the probes a pixel reads; the scene trace's, the history's and the motion's numbers;
 * the disocclusion's and the screen trace's thicknesses; the last view-projection's inverse. The words that differ from
 * those it sent go up (`writeChanged`); nothing is allocated by a call.
 */
export function createScreenProbeParams(device: GPUDevice, buffer: GPUBuffer) {
  const staged = new Float32Array(P.words)
  const words = new Uint32Array(staged.buffer)
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
