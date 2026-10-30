import { flagIf } from '../../../../../math/src/scalar/bits.ts'
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
  /** The projection's depth scale: 1 under a perspective, a power of ten under an orthographic projection (`screenRelativeThickness` of a relative thickness of one), which the slope tolerance of the short-range occlusion's rays is scaled by. */
  depthThicknessScale: number
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
  /** The eye the poses of a hit's placement are taken at, three doubles (`stHitVelocity`): the camera's. */
  eye: ArrayLike<number>
  /** The light is kept unrounded to the 11-11-10 floats' precision (`lightingDataFormat` is not `r11g11b10`): the filtered radiance keeps what the half floats of its texture hold. */
  exactLight: boolean
  /** The rays the screen left are cast through the scene's triangles this image (`TracedSceneGroups`), the scene trace the lighting made for it
   *  (`SceneRays`) held, not marched through the global distance field. */
  rays?: SceneRays
  /** The mode word of the hit lighting (`hitLightWord`) that lights those rays' hits where they stand, in place of the cards' light: none (zero) where the rays are lit from the cards. */
  hitLight?: number
  /** The exposure the CPU knows for this view's image (`PreExposure.exposure`), which the hit lighting's lights are strengthened under (1 when absent). */
  exposure?: number
}

/** The mode word's flags of an image at `settings`: each bit its meaning (`SCREEN_PROBE_FLAGS`). */
export function screenProbeFlags(settings: ScreenProbeSettings, image: ScreenProbeImage) {
  const { values } = settings
  const sampled = values.screenProbeImportanceSampling
  return (
    flagIf(image.screen && values.screenProbeScreenTraces, F.screenTraces) |
    flagIf(sampled, F.importance) |
    flagIf(sampled && settings.importanceLighting, F.importanceLighting) |
    flagIf(sampled && image.history && values.screenProbeProbeRadianceHistory, F.radianceHistory) |
    flagIf(image.history && values.screenProbeTemporal, F.temporal) |
    flagIf(settings.stochasticInterpolation, F.stochastic) |
    flagIf(image.cache, F.cache) |
    flagIf(settings.irradianceFormat === 'octahedral', F.octahedral) |
    flagIf(settings.occlusion, F.occlusion) |
    flagIf(values.screenProbeSceneTraces, F.sceneTraces) |
    flagIf(image.history && image.velocity, F.velocity) |
    flagIf(values.screenProbeFastUpdateClamp, F.fastUpdateClamp) |
    flagIf(values.screenProbeDisocclusionMaxFrames > 0, F.disocclusion) |
    flagIf(values.screenProbeOcclusionTemporal, F.occlusionTemporal) |
    flagIf(image.fullResDepth, F.fullResDepth) |
    flagIf(values.screenProbeSkipFoliageHits, F.skipFoliageHits) |
    flagIf(values.screenProbeSkipHairHits, F.skipHairHits) |
    flagIf(values.screenProbeSkipUnlitHits, F.skipUnlitHits) |
    flagIf(image.cache && settings.cache.skyVisibility, F.cacheSky) |
    flagIf(settings.backfaceDiffuse, F.backfaceDiffuse) |
    flagIf(values.screenProbeRejectBasedOnNormal, F.rejectNormal) |
    flagIf(values.screenProbeShortRangeAOApplyDuringIntegration, F.occlusionInIntegration) |
    flagIf(settings.temporalFilterProbes && image.history, F.probeTemporal) |
    flagIf(values.screenProbeMaterialAO, F.materialAo) |
    flagIf(image.posesMoving, F.posesMoving) |
    flagIf(image.exactLight, F.exactLight) |
    flagIf(values.screenProbeDebugForceTracesMoving, F.forceMoving)
  )
}
