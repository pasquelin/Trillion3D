import type {
  HlodWarmupOptions,
  WorldStreamingOptions,
} from '../../../../sdk-core/src/contracts/worldStreamingOptions.ts'
import type { CutOptions } from '../../../../sdk-core/src/contracts/cutOptions.ts'
import type { AnimationOptions } from '../../../../sdk-core/src/contracts/animationOptions.ts'
import type { ShadingOptions } from '../../../../sdk-core/src/contracts/shadingOptions.ts'
import type { ExposureOptions } from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import type { TemporalOptions } from '../../../../sdk-core/src/contracts/temporalOptions.ts'
import type { ShadowOptions } from '../../../../sdk-core/src/contracts/shadowOptions.ts'
import type { MotionBlurSettings } from '../../../../sdk-core/src/contracts/motionBlurOptions.ts'
import type { DepthOfFieldSettings } from '../../../../sdk-core/src/contracts/depthOfFieldRules.ts'
import type { BloomSettings } from '../../../../sdk-core/src/contracts/bloomRules.ts'
import type { GaussianBlurSettings } from '../../../../sdk-core/src/contracts/gaussianBlurRules.ts'
import type { FilmSettings } from '../../../../sdk-core/src/contracts/filmOptions.ts'
import type { AmbientOcclusionOptions } from '../../../../sdk-core/src/contracts/ambientOcclusionOptions.ts'
import type { ScreenProbeOptions } from '../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import type { VolumetricFogOptions } from '../../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import type { TessellationOptions } from '../../../../sdk-core/src/contracts/tessellationOptions.ts'
import type { ReflectionOptions } from '../../../../sdk-core/src/contracts/reflectionOptions.ts'
import type { WorldParts } from './worldParts.ts'

/** The world's scene settings by rule (`ruledSwitches.ts`): the streaming of a partitioned scene's
 *  cells and the HLOD warm-up, the cut and the animation; each read as its fields resolved over the
 *  page and the quality preset, and written as the page's settings the options name. */
export function worldSceneSettings({ switches, live }: WorldParts) {
  return {
    /** How the view streams a partitioned scene's cells (`worldStreaming…`) and the warm-up an
     *  HLOD switch waits on (`hlodWarmup…`), each setting by its field
     *  (`WorldOptions`), resolved over the page and the quality preset. Written, the settings
     *  named apply from the next frame over the preset — one `null` gives it back to it, one left
     *  out stays —; one a setting does not take is refused. */
    get worldStreaming() {
      return switches.worldStreaming
    },
    set worldStreaming(options: WorldStreamingOptions & HlodWarmupOptions) {
      live()
      switches.worldStreaming = options
    },
    /** The cut's occlusion in two passes, its culls and how an upscaled image's level of detail
     *  follows the display, each setting by its field (`WorldOptions`), resolved over the page and
     *  the quality preset. Written, the settings named apply from the next frame over the preset —
     *  one `null` gives it back to it, one left out stays —; one a setting does not take is
     *  refused. */
    get cut() {
      return switches.cut
    },
    set cut(options: CutOptions) {
      live()
      switches.cut = options
    },
    /** The screen size under which an instanced skinned object is drawn in its rest pose and how
     *  the scene's animation banks play their tracks, each setting by its field (`WorldOptions`),
     *  resolved over the page and the quality preset. Written, the settings named apply from the
     *  next frame over the preset — one `null` gives it back to it, one left out stays —; one a
     *  setting does not take is refused. */
    get animation() {
      return switches.animation
    },
    set animation(options: AnimationOptions) {
      live()
      switches.animation = options
    },
  }
}

/** The world's image settings by rule (`ruledSwitches.ts`): the shading bins, the exposure, the
 *  temporal pass and the sun's shadows, read and written as the scene settings are
 *  (`worldSceneSettings`). */
export function worldImageSettings({ switches, live }: WorldParts) {
  return {
    /** How the shading bins hold each material class's pixels, each setting by its field
     *  (`WorldOptions`), resolved over the page and the quality preset. Written, the settings named
     *  apply from the next frame over the preset — one `null` gives it back to it, one left out
     *  stays —; one a setting does not take is refused. */
    get shading() {
      return switches.shading
    },
    set shading(options: ShadingOptions) {
      live()
      switches.shading = options
    },
    /** The automatic exposure's settings, used where `world.exposure` is `'auto'`, each by its
     *  field (`WorldOptions`), resolved over the page and the quality preset: the bias, the
     *  range the mean is held to in EV100, the histogram's span, the shares of the pixels left
     *  out, the speeds in stops a second, the transition distance, the weight of the black
     *  bucket and how a pixel's luminance is read. Written, the settings named apply from the
     *  next frame over the preset — one `null` gives it back to it, one left out stays —; one a
     *  setting does not take is refused. */
    get exposureSettings() {
      return switches.exposureSettings
    },
    set exposureSettings(options: ExposureOptions) {
      live()
      switches.exposureSettings = options
    },
    /** The temporal anti-aliasing's settings beside its level, each by its field (`WorldOptions`),
     *  resolved over the page and the quality preset: `temporalThinGeometry`, whether the pass
     *  looks for geometry thinner than a pixel and relaxes its history there. Written, the
     *  settings named apply from the next frame over the preset — one `null` gives it back to it,
     *  one left out stays —; one a setting does not take is refused. */
    get temporal() {
      return switches.temporal
    },
    set temporal(options: TemporalOptions) {
      live()
      switches.temporal = options
    },
    /** The sun's shadows' settings, each by its field (`WorldOptions`), resolved over the page and
     *  the quality preset: `shadowDistanceScale`, the factor on every directional light's
     *  `shadowDistance`; `farShadowCulling`, whether a sun's shadow maps leave out the casters
     *  past the edge of that distance unless their object sets `castFarShadow`;
     *  `farShadowCullsAllMeshes`, whether that test reaches every caster or the world's merged
     *  shells alone; the three that shape the edge, `shadowNearLevels`, `shadowOverlapScale`
     *  and `shadowFarField`; and the shadow maps' own (`shadowMapOptions.ts`). Written, the
     *  settings named apply from the next frame over the preset — one `null` gives it back to it,
     *  one left out stays —; one a setting does not take is refused. */
    get shadows() {
      return switches.shadows
    },
    set shadows(options: ShadowOptions) {
      live()
      switches.shadows = options
    },
    /** How the motion blur is drawn, each setting by its field (`WorldOptions`), resolved over the
     *  page and the quality preset: `motionBlurQuality` (`'off'`, `'low'`, `'medium'`, `'high'`,
     *  `'veryHigh'`), `motionBlurHalfResGather`, `motionBlurHalfResInput`, `motionBlurSeparable`,
     *  `motionBlurScatter` and `motionBlurDirections`. The blur's strength, longest streak and frame rate are the effect's
     *  (`world.effects`, `effect.motionBlur`). Written, the settings named apply from the next
     *  frame over the preset — one `null` gives it back to it, one left out stays —; one a setting
     *  does not take is refused. */
    get motionBlur() {
      return switches.motionBlur
    },
    set motionBlur(options: MotionBlurSettings) {
      live()
      switches.motionBlur = options
    },
    /** How the depth of field is drawn, each setting by its field (`WorldOptions`), resolved over the
     *  page and the quality preset: `depthOfFieldQuality` (`'off'`, `'on'`), the gather's divisor,
     *  accumulator, bokeh, post-filter and rings, the scatter's modes and limits, the recombine's
     *  quality and the temporal accumulation's. The lens, the focus and the camera are the
     *  effect's (`world.effects`, `effect.depthOfField`). Written, the settings named apply from the next
     *  frame over the preset — one `null` gives it back to it, one left out stays —; one a setting
     *  does not take is refused. */
    get depthOfField() {
      return switches.depthOfField
    },
    set depthOfField(options: DepthOfFieldSettings) {
      live()
      switches.depthOfField = options
    },
    /** How the bloom is drawn, each setting by its field (`WorldOptions`), resolved over the page
     *  and the quality preset: `bloomQuality` (`'off'`, `'lowest'`, `'low'`, `'medium'`, `'high'`,
     *  `'highest'`), `bloomCross`, `bloomScreenPercentage`,
     *  `bloomApplyLocalExposure` and `bloomCacheKernel`. The glow's method, intensity, levels, convolution and dirt mask are the
     *  effect's (`world.effects`, `effect.bloom`). Written, the settings named apply from the next
     *  frame over the preset — one `null` gives it back to it, one left out stays —; one a setting
     *  does not take is refused. */
    get bloom() {
      return switches.bloom
    },
    set bloom(options: BloomSettings) {
      live()
      switches.bloom = options
    },
    /** How the Gaussian blur of the bloom's levels and of the local exposure's blurred luminance is
     *  drawn, each setting by its field (`WorldOptions`), resolved over the page and the quality
     *  preset: `gaussianFastBlurThreshold` (the radius from which a blur writes its first pass at
     *  half the width), `gaussianSampleScale` (the reach of the kernel as a multiple of its radius)
     *  and `gaussianLoopMode` (the most reads of a pass). Written, the settings named apply from the
     *  next frame over the preset — one `null` gives it back to it, one left out stays —; one a
     *  setting does not take is refused. */
    get gaussianBlur() {
      return switches.gaussianBlur
    },
    set gaussianBlur(options: GaussianBlurSettings) {
      live()
      switches.gaussianBlur = options
    },
    /** The film effects of the display finishing, each setting by its field (`WorldOptions`),
     *  resolved over the page and the quality preset: the film grain (`filmGrain…`), the colour
     *  fringe (`chromaticAberration…`), the vignette's look (`vignette…`; its strength is the
     *  scene's), the tonemapper's quality and sharpening, the scene's tint (`sceneColorTint…`) and
     *  the dither (`quantizationDitheringBits`). Written, the settings named apply from the next
     *  frame over the preset — one `null` gives it back to it, one left out stays —; one a setting
     *  does not take is refused. */
    get film() {
      return switches.film
    },
    set film(options: FilmSettings) {
      live()
      switches.film = options
    },
    /** The screen-space ambient occlusion's settings, each by its field (`WorldOptions`), resolved
     *  over the page and the quality preset: `ambientOcclusion`, the master switch, its
     *  `ambientOcclusionIntensity` (0 is off), radius, fade distance and radius, power and bias, its quality
     *  and the resolutions and ceiling that follow it, and `ambientOcclusionWithScreenProbes`. It applies
     *  where no screen probes light the pixels. Written, the settings named apply from the next
     *  frame over the preset — one `null` gives it back to it, one left out stays —; one a setting
     *  does not take is refused. */
    get ambientOcclusion() {
      return switches.ambientOcclusion
    },
    set ambientOcclusion(options: AmbientOcclusionOptions) {
      live()
      switches.ambientOcclusion = options
    },
    /** The indirect light's settings, each by its field (`WorldOptions`), resolved over the page
     *  and the quality preset: `screenProbes`, the level of the probes placed on the screen that
     *  light each pixel (`'off'`, `'high'`, `'ultra'`, `'cinematic'`), then their quality, update
     *  speed, adaptive share, screen traces, importance sampling, spatial filter and its passes,
     *  ray intensity, temporal blend, frames held, and short-range occlusion with its strength.
     *  Written, the settings named apply from the next frame over the preset — one `null` gives it
     *  back to it, one left out stays —; one a setting does not take is refused. */
    get indirectLight() {
      return switches.indirectLight
    },
    set indirectLight(options: ScreenProbeOptions) {
      live()
      switches.indirectLight = options
    },
    /** The reflections' trace settings, each by its field (`WorldOptions`), resolved over the page
     *  and the quality preset: the iterations of a reflected ray's march of the screen, the steps it
     *  takes in each ring of the scene, its detail window, and the screen's far trace
     *  (`reflectionOptions.ts`). Written, the settings named apply from the next frame over the preset
     *  — one `null` gives it back to it, one left out stays —; one a setting does not take is refused. */
    get reflections() {
      return switches.reflections
    },
    set reflections(options: ReflectionOptions) {
      live()
      switches.reflections = options
    },
    /** The volumetric fog's settings, each by its field (`WorldOptions`), resolved over the page
     *  and the quality preset: `volumetricFogQuality` (`'off'`, `'high'`, `'max'`, `'cinematic'`)
     *  and the eleven settings the fog volume is read with. Written, the settings named apply
     *  from the next frame over the preset — one `null` gives it back to it, one left out stays —;
     *  one a setting does not take is refused. */
    get volumetricFog() {
      return switches.volumetricFog
    },
    set volumetricFog(options: VolumetricFogOptions) {
      live()
      switches.volumetricFog = options
    },
    /** The tessellation of displaced materials, each setting by its field (`WorldOptions`),
     *  resolved over the page and the quality preset: `tessellation`, whether a material that
     *  names a displacement is cut into micro-triangles and displaced; `tessellationDicingRate`,
     *  their size in pixels; `tessellationMaxPatchesPerGroup`; `tessellationMaxCandidatePatches`
     *  and `tessellationMaxVisiblePatches`, the patches the splitting queue and the visible list
     *  hold; `tessellationShadowsDirectional` and `tessellationShadowsLocal`, whether the displaced
     *  shape is cast into the shadow maps of the suns and of the local lights. Written, the settings named apply from the next frame over the preset — one `null`
     *  gives it back to it, one left out stays —; one a setting does not take is refused. */
    get tessellation() {
      return switches.tessellation
    },
    set tessellation(options: TessellationOptions) {
      live()
      switches.tessellation = options
    },
  }
}
