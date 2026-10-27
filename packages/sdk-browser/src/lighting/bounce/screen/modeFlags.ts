import type { ScreenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import type { SceneRays } from '../../surfaceCache/lighting/surfaceLighting.ts'
import { SCREEN_PROBE_FLAGS as F } from './screenProbeLayout.ts'

/** What an image tells its kernels beside its settings and its probes' shapes: its rank, and what
 *  this image has to read. */
export interface ScreenProbeImage {
  /** The view's frame index, the image's stochastic phase (`stochasticPhase`): its tile jitter, its ray directions' turn, its noise, which
   *  a fixed index may move for some of the passes (`createScreenProbeParams`). It advances on every image drawn. */
  frame: number
  /** The phase of the image the history holds: `frame` less one, none before the first. */
  previousFrame: number
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
  /** The relative thickness the history-depth test gives a hit, times the projection's depth scale likewise (`screenRelativeThickness`). */
  historyThickness: number
  /** Whether the trace's march goes down to the full-resolution depth (`hizFullResDepth`). */
  fullResDepth: boolean
  /** The share of the sky light that leaks onto the surfaces the rays find, by channel: the leaking times its tint, which the reflections' resolved settings hold (`ReflectionSettings.skylightLeakColor`). */
  skylightLeak: readonly [number, number, number]
  /** The roughness past which the rough specular of a pixel with backface diffuse light is the diffuse light over pi: the setting's, else the reflections' level's row
   *  (`ReflectionSettings.maxRoughnessEvaluateFoliage`). */
  roughSpecularFoliage: number
  /** A placement's pose moved since the poses the last drawn frame drew were kept (`GpuSelection.posesMoving`): the placement a ray's hit met has a speed to measure; else it has none. */
  posesMoving: boolean
  /** The rays the screen left are cast through the scene's triangles this image (`TracedSceneGroups`), the scene trace the lighting made for it
   *  (`SceneRays`) held, not marched through the global distance field. */
  rays?: SceneRays
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
    bit(image.history && image.velocity, F.velocity) |
    bit(values.screenProbeFastUpdateClamp, F.fastUpdateClamp) |
    bit(values.screenProbeDisocclusionMaxFrames > 0, F.disocclusion) |
    bit(values.screenProbeOcclusionTemporal, F.occlusionTemporal) |
    bit(image.fullResDepth, F.fullResDepth) |
    bit(values.screenProbeSkipFoliageHits, F.skipFoliageHits) |
    bit(values.screenProbeSkipHairHits, F.skipHairHits) |
    bit(values.screenProbeSkipUnlitHits, F.skipUnlitHits) |
    bit(image.cache && settings.cache.skyVisibility, F.cacheSky) |
    bit(settings.backfaceDiffuse, F.backfaceDiffuse) |
    bit(values.screenProbeRejectBasedOnNormal, F.rejectNormal) |
    bit(values.screenProbeShortRangeAOApplyDuringIntegration, F.occlusionInIntegration) |
    bit(settings.temporalFilterProbes && image.history, F.probeTemporal) |
    bit(values.screenProbeMaterialAO, F.materialAo) |
    bit(image.posesMoving, F.posesMoving)
  )
}
