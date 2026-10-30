import type { AmbientOcclusionOptions } from '../../../../sdk-core/src/contracts/ambientOcclusionOptions.ts'
import type { AmbientCubemapSettings } from '../../../../sdk-core/src/contracts/ambientCubemapOptions.ts'
import type { ReflectionCaptureOptions } from '../../../../sdk-core/src/contracts/reflectionCaptureOptions.ts'
import type { BloomSettings } from '../../../../sdk-core/src/contracts/bloomRules.ts'
import type { ColorGradingSettings } from '../../../../sdk-core/src/contracts/colorGradingOptions.ts'
import type { DepthOfFieldSettings } from '../../../../sdk-core/src/contracts/depthOfFieldRules.ts'
import type { DistanceFieldOcclusionOptions } from '../../../../sdk-core/src/contracts/distanceFieldOcclusionOptions.ts'
import type { ExposureOptions } from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import type { FilmSettings } from '../../../../sdk-core/src/contracts/filmOptions.ts'
import type { GaussianBlurSettings } from '../../../../sdk-core/src/contracts/gaussianBlurRules.ts'
import type { GlobalDistanceFieldOptions } from '../../../../sdk-core/src/contracts/globalDistanceFieldOptions.ts'
import type { SurfaceCacheOptions } from '../../../../sdk-core/src/contracts/surfaceCacheOptions.ts'
import type { HizOptions } from '../../../../sdk-core/src/contracts/hizOptions.ts'
import type { LightFunctionOptions } from '../../../../sdk-core/src/contracts/lightFunctionOptions.ts'
import type { LightProfileOptions } from '../../../../sdk-core/src/contracts/lightProfileOptions.ts'
import type { OrderIndependentTranslucencyOptions } from '../../../../sdk-core/src/contracts/orderIndependentTranslucencyOptions.ts'
import type { SeparateTranslucencyOptions } from '../../../../sdk-core/src/contracts/separateTranslucencyOptions.ts'
import type { LightShapeOptions } from '../../../../sdk-core/src/contracts/lightShapeOptions.ts'
import type { RectLightAtlasOptions } from '../../../../sdk-core/src/contracts/rectLightAtlasOptions.ts'
import type { SimpleLightOptions } from '../../../../sdk-core/src/contracts/simpleLightOptions.ts'
import type { MotionBlurSettings } from '../../../../sdk-core/src/contracts/motionBlurOptions.ts'
import type { ReflectionOptions } from '../../../../sdk-core/src/contracts/reflectionOptions.ts'
import type { ScreenProbeOptions } from '../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import type { ShadingOptions } from '../../../../sdk-core/src/contracts/shadingOptions.ts'
import type { ShadowOptions } from '../../../../sdk-core/src/contracts/shadowOptions.ts'
import type { SkyQualityOptions } from '../../../../sdk-core/src/modules/sky/quality.ts'
import type { TemporalOptions } from '../../../../sdk-core/src/contracts/temporalOptions.ts'
import type { TessellationOptions } from '../../../../sdk-core/src/contracts/tessellationOptions.ts'
import type { TextureFilteringOptions } from '../../../../sdk-core/src/contracts/textureFilteringOptions.ts'
import type { LightingDataFormatOptions } from '../../../../sdk-core/src/contracts/lightingDataFormatOptions.ts'
import type { RayTracingOptions } from '../../../../sdk-core/src/contracts/rayTracingOptions.ts'
import type { ClosureOptions } from '../../../../sdk-core/src/contracts/closureOptions.ts'
import type { MeshDistanceFieldTraceOptions } from '../../../../sdk-core/src/contracts/meshDistanceFieldTraceOptions.ts'
import type { ScreenSpaceTracingOptions } from '../../../../sdk-core/src/contracts/screenSpaceTracingOptions.ts'
import type { SingleLayerWaterOptions } from '../../../../sdk-core/src/contracts/singleLayerWaterOptions.ts'
import type { HairStrandsOptions } from '../../../../sdk-core/src/contracts/hairStrandsOptions.ts'
import type { CustomDepthOptions } from '../../../../sdk-core/src/contracts/customDepthOptions.ts'
import type { PostProcessMaterialOptions } from '../../../../sdk-core/src/contracts/postProcessMaterialOptions.ts'
import type { HeterogeneousVolumeOptions } from '../../../../sdk-core/src/contracts/heterogeneousVolumeOptions.ts'
import type { SampledLightsOptions } from '../../../../sdk-core/src/contracts/sampledLightsOptions.ts'
import type { SubsurfaceScatteringOptions } from '../../../../sdk-core/src/contracts/subsurfaceScatteringOptions.ts'
import type { TranslucencyVolumeOptions } from '../../../../sdk-core/src/contracts/translucencyVolumeOptions.ts'
import type { TranslucencyGiOptions } from '../../../../sdk-core/src/contracts/translucencyGiOptions.ts'
import type { VolumetricFogOptions } from '../../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import type { VolumetricLightmapOptions } from '../../../../sdk-core/src/contracts/volumetricLightmapOptions.ts'
import type { FamilyValues } from '../../../../sdk-core/src/runtime/settingFamilies.ts'

/** The world's image settings by rule (`SETTING_FAMILIES`): the shading bins, the exposure, the
 *  temporal pass, the sun's shadows and the rest of the drawing's families, read and written as the scene settings are
 *  (`WorldSceneSettings`). */
export interface WorldImageSettings {
  /** How the shading bins hold each material class's pixels, each setting by its field
   *  (`WorldOptions`), resolved over the page and the quality preset. Written, the settings named
   *  apply from the next frame over the preset — one `null` gives it back to it, one left out
   *  stays —; one a setting does not take is refused. */
  get shading(): FamilyValues<'shading'>
  set shading(options: ShadingOptions)
  /** The automatic exposure's settings, used where `world.exposure` is `'auto'`, each by its
   *  field (`WorldOptions`), resolved over the page and the quality preset: the bias, the
   *  range the mean is held to in EV100, the histogram's span, the shares of the pixels left
   *  out, the speeds in stops a second, the transition distance, the weight of the black
   *  bucket and how a pixel's luminance is read. Written, the settings named apply from the
   *  next frame over the preset — one `null` gives it back to it, one left out stays —; one a
   *  setting does not take is refused. */
  get exposureSettings(): FamilyValues<'exposure'>
  set exposureSettings(options: ExposureOptions)
  /** The temporal anti-aliasing's settings beside its level, each by its field (`WorldOptions`),
   *  resolved over the page and the quality preset: `temporalThinGeometry`, whether the pass
   *  looks for geometry thinner than a pixel and relaxes its history there; `temporalWaveOps`,
   *  `temporalWaveSize` and `temporalHalfPrecision`, how its programs run (subgroups, their
   *  size, 16-bit floats, where the device grants them), the image the same; the history's
   *  samples, the flicker measure's, the thin geometry detection's thresholds, the exposure the
   *  rejection measures at and `temporalDownsampleQuality`, the quality of the half-size image the
   *  exposure and the bloom read. Written, the settings named apply from the next frame over the preset — one `null` gives it back to it,
   *  one left out stays —; one a setting does not take is refused. */
  get temporal(): FamilyValues<'temporal'>
  set temporal(options: TemporalOptions)
  /** The depth pyramid's settings, each by its field (`WorldOptions`), resolved over the page
   *  and the quality preset: `hizTrace`, how the reflections' trace reads the pyramid;
   *  `hizFoldTransparents`, whether its trace layers hold the transparent surfaces;
   *  `hizTransparentTest`, how the transparent clusters are tested against it;
   *  `hizFullResDepth`, whether the screen probes' walk goes down to the full-resolution depth;
   *  `lightGridHizCull`, whether the light grid leaves empty the cells behind their column's
   *  farthest depth; `lightGridLinkedLists`, whether its cells' lists are made from chains of
   *  links taken from one pool, else each cell has its share; `lightGridMaxCulledLightsPerCell`, the
   *  light entries the view's light grid holds per cell; `hizPrime` (`'off'`, `'whenMissing'`, `'always'`) with `hizPrimeSizeBias`,
   *  `hizPrimeDepthBias`, `hizPrimeErrorScale` and `hizPrimeFarFieldOnly`, the pyramid built
   *  from a small, coarse draw of the objects that set `farField`. Written, the
   *  settings named apply from the next frame over the preset — one `null` gives it back to
   *  it, one left out stays —; one a setting does not take is refused. */
  get hiz(): FamilyValues<'hiz'>
  set hiz(options: HizOptions)
  /** The light functions' settings, each by its field (`WorldOptions`), resolved over the page and
   *  the quality preset: `lightFunctionAtlas` (true) — whether the atlas is made —,
   *  `lightFunctionSlotResolution` (128) and `lightFunctionAtlasSize` (4) — the slot's texels a side
   *  and the slots a side —, `lightFunctionMaxLights` (-1, no limit), `lightFunctionFormat`
   *  (`'grey'` or `'colour'`), and the consumers: `lightFunctionDeferred` (true),
   *  `lightFunctionFog` (true), `lightFunctionBounce` (true), `lightFunctionTranslucent` (false).
   *  Written, the settings named apply from the next frame over the preset — one `null` gives it
   *  back to it, one left out stays —; one a setting does not take is refused. */
  get lightFunction(): FamilyValues<'lightFunction'>
  set lightFunction(options: LightFunctionOptions)
  /** The light profiles' atlas settings, each by its field (`WorldOptions`), resolved over the page and
   *  the quality preset: `lightProfileAtlasResolution` (256) — the texels a side of a slice; a profile of another
   *  side is resampled to it — and `lightProfileAtlasMaxProfiles` (32, from 1 to 32) — the most profiles the atlas
   *  holds; it is made with the profiles the lights ask, up to this, and made again when more are asked —, and the
   *  switches `lightProfileAtlasForceUpdate` (false, every profile written again at every image) and `lightProfileAtlasDebug` (false, the atlas drawn over the image).
   *  Written, the settings named apply from the next frame over the preset — one `null` gives it
   *  back to it, one left out stays —; one a setting does not take is refused. */
  get lightProfile(): FamilyValues<'lightProfile'>
  set lightProfile(options: LightProfileOptions)
  /** The light shapes' visualization settings, each by its field (`WorldOptions`), resolved over the page and the quality preset:
   *  `visualizeLightShape` (false) — each point, spot and rectangle light drawn as a wireframe of its reach over the lit image —,
   *  `visualizeLightShapeFadeDuration` (0.5 seconds), `visualizeLightShapeMaxDelayDistance` (4000 centimetres), `visualizeLightShapeMaxDelay`
   *  (2.5 seconds) and `visualizeLightShapeMaxOpacity` (0.1).
   *  Written, the settings named apply from the next frame over the preset — one `null` gives it back to it, one left out stays —;
   *  one a setting does not take is refused. */
  get lightShape(): FamilyValues<'lightShape'>
  set lightShape(options: LightShapeOptions)
  /** The per-pixel sorted translucency settings, each by its field (`WorldOptions`), resolved over the page and the quality preset:
   *  `oitSortedPixels` (false) — the project switch, read when the session opens, that lets the `normal` and `additive` layers be collected per pixel —,
   *  `oitSortedPixelsEnable` (true), `oitPassType` (3), `oitMaxSampleCount` (4, from 1 to 16), `oitMethod` (1: multi-layer alpha blending; 0: k-buffer, a name the debug text shows: the fragments are kept the same way),
   *  `oitTransmittanceThreshold` (0.05), `oitDebug` (0) with `oitDebugCursorX` and `oitDebugCursorY` (-1, the pixel whose samples are written).
   *  Written, the settings named apply from the next frame over the preset — one `null` gives it back to it, one left out stays —;
   *  one a setting does not take is refused. */
  get orderIndependentTranslucency(): FamilyValues<'orderIndependentTranslucency'>
  set orderIndependentTranslucency(options: OrderIndependentTranslucencyOptions)
  /** The resolution of the translucent layers, each setting by its field (`WorldOptions`), resolved over the page and the quality preset:
   *  `translucencyScreenPercentage` (100, from 0 to 100: the share of the resolution they are drawn at), `translucencyScreenPercentageBasis`
   *  (0 the render size, 1 the display size) and `translucencyUpsampleMode` (1 the nearest depth neighbour with a share of 50, 0 bilinear).
   *  Written, the settings named apply from the next frame over the preset — one `null` gives it back to it, one left out stays —;
   *  one a setting does not take is refused. */
  get separateTranslucency(): FamilyValues<'separateTranslucency'>
  set separateTranslucency(options: SeparateTranslucencyOptions)
  /** The rectangle lights' source-texture atlas settings, each by its field (`WorldOptions`), resolved over the page and the quality
   *  preset: `rectLightAtlasMaxResolution` (4096) — the largest side of the atlas —, `rectLightAtlasFilterQuality` (0, a box; 1, a Gaussian),
   *  `rectLightAtlasMaxTextureRatio` (2), `rectLightAtlasFormat` (0, 11/11/10 bits; 1, 16-bit floats), `sampledLightsTexturedRectLights` (true), and the debug and repack switches (`rectLightAtlasDebug`, `rectLightAtlasDebugMipLevel`,
   *  `rectLightAtlasForceUpdate`, `rectLightAtlasResetOnChange`, `rectLightAtlasClear`, `rectLightAtlasDebugClear`, all off).
   *  Written, the settings named apply from the next frame over the preset — one `null` gives it back to it, one left out stays —;
   *  one a setting does not take is refused. */
  get rectLightAtlas(): FamilyValues<'rectLightAtlas'>
  set rectLightAtlas(options: RectLightAtlasOptions)
  /** The simple lights' settings, each by its field (`WorldOptions`), resolved over the page and the quality preset: `allowSimpleLights` (true) —
   *  whether the lights the host hands to an image are taken —, `hairSimpleLights` (true) — whether the hair strands are lit by them — and
   *  `sampledSimpleLights` (1) — which of them the sampled lighting takes: 0 none, 1 those whose entry allows it, 2 all.
   *  Written, the settings named apply from the next frame over the preset — one `null` gives it back to it, one left out stays —;
   *  one a setting does not take is refused. */
  get simpleLight(): FamilyValues<'simpleLight'>
  set simpleLight(options: SimpleLightOptions)
  /** The volumetric lightmap's setting, by its field (`WorldOptions`), resolved over the page and
   *  the quality preset: `volumetricLightmap`, whether the precomputed light is read, on by
   *  default. Written, the setting named applies from the next frame over the preset — `null`
   *  gives it back to it, a field left out stays —; one the setting does not take is refused. */
  get volumetricLightmap(): FamilyValues<'volumetricLightmap'>
  set volumetricLightmap(options: VolumetricLightmapOptions)
  /** The global distance field's settings, each by its field (`WorldOptions`), resolved over the
   *  page and the quality preset: `globalDistanceField` (true) — whether the clipmaps are made —,
   *  `globalDistanceFieldClipmaps` (4), `globalDistanceFieldViewDistance` (20000 cm), their
   *  resolution (128), update rhythm (two clipmaps a frame, the larger ones less often), caches
   *  (the static meshes composited apart), and the budgets of the atlas the meshes' distance
   *  fields are streamed into (`meshDistanceField…`). Written, the settings named apply from the
   *  next frame over the preset — one `null` gives it back to it, one left out stays —; one a
   *  setting does not take is refused. */
  get globalDistanceField(): FamilyValues<'globalDistanceField'>
  set globalDistanceField(options: GlobalDistanceFieldOptions)
  /** The surface cache's settings, each by its field (`WorldOptions`), resolved over the page and the
   *  quality preset: the cards each mesh carries and the atlas their captured surface is kept in —
   *  `surfaceCacheAtlasSize` (4096 texels a side), `surfaceCacheResolution` (1), `surfaceCacheSceneDetail` (1),
   *  the resolution a card is kept at by its size on the screen (`surfaceCacheCardTexelDensityScale`,
   *  `surfaceCacheCardMinResolution`, `surfaceCacheCardMaxResolution`, `surfaceCacheCardMaxTexelDensity`), the
   *  captures an image makes (`surfaceCacheCardCapturesPerFrame`, 300) and the share that captures pages again
   *  (`surfaceCacheCardCaptureRefreshFraction`, 0.125), the sharing of captures between cards of one mesh
   *  (`surfaceCacheAllowCardSharing`, true), the dilation of a page by a texel (`surfaceCacheDilationMode`, 0) and the
   *  feedback of the rays that read it (`surfaceCacheFeedback…`). Written, the settings named apply from the next
   *  frame over the preset — one `null` gives it back to it, one left out stays —; one a setting does not take is
   *  refused. */
  get surfaceCache(): FamilyValues<'surfaceCache'>
  set surfaceCache(options: SurfaceCacheOptions)
  /** The sky light's distance-field occlusion settings, each by its field (`WorldOptions`), resolved over the page and
   *  the quality preset: `distanceFieldOcclusion` (true) — whether the sky light is occluded by the distance fields —,
   *  `distanceFieldOcclusionQuality` (2: 1 the global field alone, 2 the meshes' fields too), the samples' spacing, the
   *  farthest a pixel is lit by it (`distanceFieldOcclusionMaxViewDistance`, 20000 cm), the cones' sample set and
   *  jitter, the temporal filter (`distanceFieldOcclusionUseHistory`, a weight of 0.85, a distance threshold of
   *  30 cm, a stability pass), the specular occlusion's mode (`distanceFieldOcclusionSpecularMode`) and strength
   *  (`skyLightSpecularOcclusionStrength`) and the room of a screen tile for meshes. Written, the settings named apply
   *  from the next frame over the preset — one `null` gives it back to it, one left out stays —; one a setting does
   *  not take is refused. */
  get distanceFieldOcclusion(): FamilyValues<'distanceFieldOcclusion'>
  set distanceFieldOcclusion(options: DistanceFieldOcclusionOptions)
  /** The sun's shadows' settings, each by its field (`WorldOptions`), resolved over the page and
   *  the quality preset: `shadowDistanceScale`, the factor on every directional light's
   *  `shadowDistance`; `farShadowCulling`, whether a sun has a near edge and the
   *  distance-field cascade that follows it; the three that shape the edge, `shadowNearLevels`, `shadowOverlapScale`
   *  and `shadowFarField`; the far levels' and the distance-field cascade's own
   *  (`sunShadowOptions.ts`); and the shadow maps' own (`shadowMapOptions.ts`). Written, the
   *  settings named apply from the next frame over the preset — one `null` gives it back to it,
   *  one left out stays —; one a setting does not take is refused. */
  get shadows(): FamilyValues<'shadows'>
  set shadows(options: ShadowOptions)
  /** How the motion blur is drawn, each setting by its field (`WorldOptions`), resolved over the
   *  page and the quality preset: `motionBlurQuality` (`'off'`, `'low'`, `'medium'`, `'high'`,
   *  `'veryHigh'`), `motionBlurHalfResGather`, `motionBlurHalfResInput`, `motionBlurSeparable`,
   *  `motionBlurScatter` and `motionBlurDirections`. The blur's strength, longest streak and frame rate are the effect's
   *  (`world.effects`, `effect.motionBlur`). Written, the settings named apply from the next
   *  frame over the preset — one `null` gives it back to it, one left out stays —; one a setting
   *  does not take is refused. */
  get motionBlur(): FamilyValues<'motionBlur'>
  set motionBlur(options: MotionBlurSettings)
  /** How the depth of field is drawn, each setting by its field (`WorldOptions`), resolved over the
   *  page and the quality preset: `depthOfFieldQuality` (`'off'`, `'on'`), the gather's divisor,
   *  accumulator, bokeh, post-filter and rings, the scatter's modes and limits, the recombine's
   *  quality and the temporal accumulation's. The lens, the focus and the camera are the
   *  effect's (`world.effects`, `effect.depthOfField`). Written, the settings named apply from the next
   *  frame over the preset — one `null` gives it back to it, one left out stays —; one a setting
   *  does not take is refused. */
  get depthOfField(): FamilyValues<'depthOfField'>
  set depthOfField(options: DepthOfFieldSettings)
  /** How the bloom is drawn, each setting by its field (`WorldOptions`), resolved over the page
   *  and the quality preset: `bloomQuality` (`'off'`, `'lowest'`, `'low'`, `'medium'`, `'high'`,
   *  `'highest'`), `bloomCross`, `bloomScreenPercentage`,
   *  `bloomApplyLocalExposure` and `bloomCacheKernel`. The glow's method, intensity, levels, convolution and dirt mask are the
   *  effect's (`world.effects`, `effect.bloom`). Written, the settings named apply from the next
   *  frame over the preset — one `null` gives it back to it, one left out stays —; one a setting
   *  does not take is refused. */
  get bloom(): FamilyValues<'bloom'>
  set bloom(options: BloomSettings)
  /** How the Gaussian blur of the bloom's levels and of the local exposure's blurred luminance is
   *  drawn, each setting by its field (`WorldOptions`), resolved over the page and the quality
   *  preset: `gaussianFastBlurThreshold` (the radius from which a blur writes its first pass at
   *  half the width), `gaussianSampleScale` (the reach of the kernel as a multiple of its radius)
   *  and `gaussianLoopMode` (the most reads of a pass). Written, the settings named apply from the
   *  next frame over the preset — one `null` gives it back to it, one left out stays —; one a
   *  setting does not take is refused. */
  get gaussianBlur(): FamilyValues<'gaussianBlur'>
  set gaussianBlur(options: GaussianBlurSettings)
  /** The film effects of the display finishing, each setting by its field (`WorldOptions`),
   *  resolved over the page and the quality preset: the film grain (`filmGrain…`), the colour
   *  fringe (`chromaticAberration…`), the vignette's look (`vignette…`; its strength is the
   *  scene's), the tonemapper's quality and sharpening, the scene's tint (`sceneColorTint…`) and
   *  the dither (`quantizationDitheringBits`) and the alpha channel (`propagateAlpha`). Written, the settings named apply from the next
   *  frame over the preset — one `null` gives it back to it, one left out stays —; one a setting
   *  does not take is refused. */
  get film(): FamilyValues<'film'>
  set film(options: FilmSettings)
  /** The colour grading of the display, each setting by its field (`WorldOptions`), resolved over
   *  the page and the quality preset: the film curve's own settings (`film…`, `blueCorrection`,
   *  `expandGamut`, `toneCurveAmount`), the white balance (`temperatureType`, `whiteTemperature`,
   *  `whiteTint`), the grade of the light and of its dark, middle and bright parts (`colorSaturation…`,
   *  `colorContrast…`, `colorGamma…`, `colorGain…`, `colorOffset…`, and where the parts end), the
   *  correction (`colorMin`, `colorMid`, `colorMax`), the display's gamma and transfer
   *  (`displayGamma`, `tonemapperGamma`, `sdrInverseEotf`) and the table the colour is baked into
   *  (`lutSize`, `lutShaper`). Written, the settings named apply from the next frame over the
   *  preset — one `null` gives it back to it, one left out stays —; one a setting does not take is
   *  refused. */
  get colorGrading(): FamilyValues<'colorGrading'>
  set colorGrading(options: ColorGradingSettings)
  /** The screen-space ambient occlusion's settings, each by its field (`WorldOptions`), resolved
   *  over the page and the quality preset: `ambientOcclusion`, the master switch, its
   *  `ambientOcclusionIntensity` (0 is off), radius, fade distance and radius, power and bias, its quality
   *  and the resolutions and ceiling that follow it, `ambientOcclusionMethod` (the disc search or the horizon search, whose
   *  own settings are `ambientOcclusionHorizon…`), `ambientOcclusionCompute` and `ambientOcclusionWithScreenProbes`.
   *  It applies where no global illumination is on (the bounce off). Written, the settings named apply from the next
   *  frame over the preset — one `null` gives it back to it, one left out stays —; one a setting
   *  does not take is refused. */
  get ambientOcclusion(): FamilyValues<'ambientOcclusion'>
  set ambientOcclusion(options: AmbientOcclusionOptions)
  /** The ambient cubemap's settings, each by its field (`WorldOptions`), resolved over the page: `ambientCubemapTintRed`,
   *  `ambientCubemapTintGreen` and `ambientCubemapTintBlue` (1 each), the tint of the cube's light, and `ambientCubemapIntensity` (1),
   *  the scale that multiplies it. The cube itself is a world option (`WorldOptions.ambientCubemap`: the six faces' linear colours and
   *  the side, a power of two from 16 to 1024), given at the opening; with none, nothing is drawn. Written, the settings named apply
   *  from the next frame — one `null` gives it back to its default, one left out stays —; one a setting does not take is refused. */
  get ambientCubemap(): FamilyValues<'ambientCubemap'>
  set ambientCubemap(options: AmbientCubemapSettings)
  /** The reflection captures' settings, each by its field (`WorldOptions`), resolved over the page: `reflectionCaptures` (true), `reflectionCaptureResolution` (128),
   *  `reflectionCaptureSupersample` (1), `reflectionCaptureNearPlane` (0.05 m), `reflectionCaptureLightFunctions` (false), `reflectionCaptureDiffuse` (false) and
   *  `reflectionCaptureDiffuseReference` (true). Written, the settings named apply from the next frame; one a setting does not take is refused. */
  get reflectionCapture(): FamilyValues<'reflectionCapture'>
  set reflectionCapture(options: ReflectionCaptureOptions)
  /** The screen-space subsurface scattering's settings, each by its field (`WorldOptions`), resolved over the page and the quality
   *  preset: `subsurfaceScattering`, the master switch, `subsurfaceScale` (the scale of every profile's radius, 0 off),
   *  `subsurfaceHalfResolution` and `subsurfaceHalfResolutionSeparable`, `subsurfaceRecombineQuality`, `subsurfaceFilter`,
   *  `subsurfaceSampleSet`, `subsurfaceCheckerboard` and `subsurfaceCheckerboardNeighborValidation`, the sampled scattering's
   *  `subsurfaceBurleyQuality`, `subsurfaceBurleySamples`, `subsurfaceBurleyProfileIdCache`, `subsurfaceBurleyBilateralKernel` and
   *  `subsurfaceBurleyMipsMinTileCount`, and `subsurfaceSubpixelThreshold` and `subsurfaceSamplingChannel`. Written, the settings named apply
   *  from the next frame over the preset — one `null` gives it back to it, one left out stays —; one a setting does not take is refused. */
  get subsurfaceScattering(): FamilyValues<'subsurfaceScattering'>
  set subsurfaceScattering(options: SubsurfaceScatteringOptions)
  /** The indirect light's settings, each by its field (`WorldOptions`), resolved over the page
   *  and the quality preset: `screenProbes`, the level of the probes placed on the screen that
   *  light each pixel (`'off'`, `'high'`, `'ultra'`, `'cinematic'`), then their quality, update
   *  speed, adaptive share, screen traces, importance sampling, spatial filter and its passes,
   *  ray intensity, temporal blend, frames held, and short-range occlusion with its strength.
   *  Written, the settings named apply from the next frame over the preset — one `null` gives it
   *  back to it, one left out stays —; one a setting does not take is refused. */
  get indirectLight(): FamilyValues<'indirectLight'>
  set indirectLight(options: ScreenProbeOptions)
  /** The reflections' trace settings, each by its field (`WorldOptions`), resolved over the page
   *  and the quality preset: the iterations of a reflected ray's march of the screen, the screen's far trace
   *  and the denoiser
   *  (`reflectionOptions.ts`). Written, the settings named apply from the next frame over the preset
   *  — one `null` gives it back to it, one left out stays —; one a setting does not take is refused. */
  get reflections(): FamilyValues<'reflections'>
  set reflections(options: ReflectionOptions)
  /** The screen-space traces' settings, each by its field (`WorldOptions`), resolved over the page: what answers the reflections and the indirect
   *  diffuse light (`reflectionMethod`, `globalIlluminationMethod`: `'scene'`, `'screen'` or `'off'`) and the quality, roughness fade, tiles, stencil,
   *  compute path and temporal filter of the screen reflections, the rays and sky distance of the screen indirect light (`screenSpaceTracingOptions.ts`). */
  get screenSpaceTracing(): FamilyValues<'screenSpaceTracing'>
  set screenSpaceTracing(options: ScreenSpaceTracingOptions)
  /** The lighting data format's setting (`lightingDataFormat`, `r11g11b10` by default), resolved over the page: the format the light is kept at between the passes of the indirect light (`lightingDataFormatOptions.ts`). */
  get lightingDataFormat(): FamilyValues<'lightingDataFormat'>
  set lightingDataFormat(options: LightingDataFormatOptions)
  /** The project's ray tracing switch (`rayTracingEnable`, on by default, as a new project has it), resolved over the page: off, every feature that traces the scene's triangles (the reflections, the screen probes and their radiance cache, the surface cache's direct light and radiosity, the translucency volume, the heterogeneous volumes, the scene view) reads its own ray tracing setting off and marches the distance fields instead (`rayTracingOptions.ts`).
   *  `world.rayTracing = { rayTracingEnable: false } // every feature traces the distance fields, as a project with ray tracing off` */
  get rayTracing(): FamilyValues<'rayTracing'>
  set rayTracing(options: RayTracingOptions)
  /** The closures' settings (`closuresPerPixel`, 4; `closureCountFromMaterial`, on; `stochasticClosureLighting`, off), resolved over the page: the most closures a material built from a closure tree keeps a pixel, whether a view counts them from the materials in view, and whether the sampled lighting lights one closure picked at random a pixel in place of all of them (`closureOptions.ts`).
   *  `world.closures = { closuresPerPixel: 2 } // a tree of more closures is simplified to two` */
  get closures(): FamilyValues<'closures'>
  set closures(options: ClosureOptions)
  /** The meshes' fields trace's settings, each by its field (`WorldOptions`), resolved over the page: whether the rays of the indirect light, the reflections and the surface cache's
   *  shadows march the meshes' own distance fields (`meshDistanceFieldTrace`, off by default), which of them do, how far, and the view grid the meshes are culled to (`meshDistanceFieldTraceOptions.ts`). */
  get meshDistanceFieldTrace(): FamilyValues<'meshDistanceFieldTrace'>
  set meshDistanceFieldTrace(options: MeshDistanceFieldTraceOptions)
  /** The volumetric fog's settings, each by its field (`WorldOptions`), resolved over the page
   *  and the quality preset: `volumetricFogQuality` (`'off'`, `'low'`, `'high'`, `'ultra'`)
   *  and the eleven settings the fog volume is read with. Written, the settings named apply
   *  from the next frame over the preset — one `null` gives it back to it, one left out stays —;
   *  one a setting does not take is refused. */
  get volumetricFog(): FamilyValues<'volumetricFog'>
  set volumetricFog(options: VolumetricFogOptions)
  /** The translucency lighting volume's settings, each by its field (`WorldOptions`), resolved over
   *  the page and the quality preset: `translucencyVolume` (true) — whether the field of light the
   *  see-through surfaces whose material sets `translucencyLighting` to `'volume'`, `'volumetric'`
   *  or `'volumetricNonDirectional'` read is made —, `translucencyVolumeDim` (64 cells a side
   *  of each of its two cascades), `translucencyVolumeInnerDistance` (15 m) and
   *  `translucencyVolumeOuterDistance` (50 m), the spatial filter
   *  `translucencyVolumeBlur` (true) and the temporal one, run first, `translucencyVolumeTemporal` (false, with
   *  `translucencyVolumeHistoryWeight`, 0.9),
   *  `translucencyVolumePositionOffsetRadius` (0) and the
   *  cascades' follow of the camera's field of view (`translucencyVolumeAdaptToPerspective`,
   *  `translucencyVolumeMinFov`, `translucencyVolumeFovSnap`). Written, the settings named apply from
   *  the next frame over the preset — one `null` gives it back to it, one left out stays —; one a
   *  setting does not take is refused. */
  get translucencyVolume(): FamilyValues<'translucencyVolume'>
  set translucencyVolume(options: TranslucencyVolumeOptions)
  /** The translucency global illumination volume's settings, each by its field (`WorldOptions`), resolved over the page: the
   *  indirect light of the see-through surfaces, held in a grid fitted to the view and read with one fetch.
   *  `translucencyGi` (true), `translucencyGiGridPixelSize` (32 pixels a cell), the depth distribution
   *  (`translucencyGiGridDistributionLogZScale` 1, `...LogZOffset` 1, `...ZScale` 4), `translucencyGiEndDistance` (80 m),
   *  `translucencyGiTracingResolution` (3), `translucencyGiMaxRayIntensity` (20), the spatial filter
   *  (`translucencyGiSpatialFilter`, true, with `...SampleCount` 3 and `...StandardDeviation` 5), the temporal one
   *  (`translucencyGiTemporalReprojection` true, `...Jitter` true, `...HistoryWeight` 0.9, `...MaxRayDirections` 8) and the radiance
   *  cache read (`translucencyGiTraceFromVolume`, `translucencyGiRadianceCache`: a cache of the volume's own, shaped by
   *  `translucencyGiRadianceCacheClipmapWorldExtent` 25 m, `...ClipmapDistributionBase` 2, `...GridResolution` 24, `...ProbeResolution` 8,
   *  `...NumMipmaps` 3, `...NumProbesToTraceBudget` 100, `...ProbeAtlasResolutionInProbes` 128 and `...ReprojectionRadiusScale` 10; or,
   *  with `translucencyGiShareRadianceCacheWithOpaque` (false), the world's probes' cache at `translucencyGiRadianceCacheClipmapBias` 3).
   *  Written, the settings named apply from the next frame — one `null` gives it back to its default, one left out stays; one a
   *  setting does not take is refused. */
  get translucencyGi(): FamilyValues<'translucencyGi'>
  set translucencyGi(options: TranslucencyGiOptions)
  /** The single-layer water's settings, each by its field (`WorldOptions`), resolved over the page:
   *  `singleLayerWater` (true), the reflection technique `singleLayerWaterReflection` (`'enabled'`)
   *  and its downsampling, reconstruction and denoising, the refraction's downsampling
   *  (`singleLayerWaterRefractionDownsample`, 1) and cullings (`singleLayerWaterRefractionCulling`, false),
   *  the sun's shadow terms and the passes and tiles of the pass. Written, the settings named apply from the
   *  next frame — one `null` gives it back its default, one left out stays —; one a setting does not take is refused. */
  get singleLayerWater(): FamilyValues<'singleLayerWater'>
  set singleLayerWater(options: SingleLayerWaterOptions)
  /** The hair strands' settings, each by its field (`WorldOptions`), resolved over the page: `hairStrands` (false) — whether
   *  the curves a scene file carries are drawn and shadowed —, the visibility buffer's samples (`hairVisibilitySamplesPerPixel`, 8:
   *  2, 4 or 8), the grooms outside the view that still cast (`hairCastShadowWhenOutOfView` true,
   *  `hairOutOfViewShadowDistance` 20 m), the voxel volume (`hairVoxelization` true, `hairVoxelWorldSize` 0.3 cm, `hairVoxelPageResolution` 32,
   *  `hairVoxelPageCountPerDim` 14, `hairVoxelAdaptive` true, `hairVoxelInjectOpaqueDepth` true), the shadow terms of its march
   *  (`hairVoxelDensityScale` 2, `hairVoxelDepthBiasScaleShadow` 2, `hairVoxelSteppingScale` 1.15) and the rays a strand's pixel casts
   *  toward a light (`shadowSmrtSamplesPerRayHair`, 1). Written, the settings named apply from the next frame — one `null` gives it
   *  back its default, one left out stays —; one a setting does not take is refused. */
  get hairStrands(): FamilyValues<'hairStrands'>
  set hairStrands(options: HairStrandsOptions)
  /** The custom depth's settings, each by its field (`WorldOptions`), resolved over the page: `customDepth` (1: on, its targets made when an object
   *  asks; 0 off, 2 kept, 3 kept with the stencil), `customDepthOrder` (2), `customDepthTemporalAAJitter` (true) and `customDepthEnableFastClear` (false).
   *  Written, the settings named apply from the next frame — one `null` gives it back its default, one left out stays —; one a setting does not take is refused. */
  get customDepth(): FamilyValues<'customDepth'>
  set customDepth(options: CustomDepthOptions)
  /** The post-process materials' settings, each by its field (`WorldOptions`), resolved over the page: `postProcessMaterials` (true), `postProcessDisableMaterials` (false),
   *  `postProcessAllowStencilTest` (true) and `postProcessAllowBlendModes` (true). Written, the settings named apply from the next frame — one `null` gives it back its
   *  default, one left out stays —; one a setting does not take is refused. */
  get postProcessMaterial(): FamilyValues<'postProcessMaterial'>
  set postProcessMaterial(options: PostProcessMaterialOptions)
  /** The heterogeneous volumes' settings, each by its field (`WorldOptions`), resolved over the page: `heterogeneousVolumes` (true) — whether
   *  the volumes of a sparse texture a scene declares are drawn —, `heterogeneousVolumesAllowed` (true) — whether the device profile allows them —,
   *  `heterogeneousVolumesShadows` (false) and `heterogeneousVolumesTranslucency` (false). Written, the settings named apply from the next
   *  frame — one `null` gives it back its default, one left out stays —; one a setting does not take is refused. */
  get heterogeneousVolumeRendering(): FamilyValues<'heterogeneousVolumeRendering'>
  set heterogeneousVolumeRendering(options: HeterogeneousVolumeOptions)
  /** The sampled lighting's settings, each by its field (`WorldOptions`), resolved over the page: `sampledLights` (false) lights the view by a few
   *  lights drawn for each pixel among the many that reach it, one shadow ray traced for each and the result denoised, so that the cost of many
   *  shadow casting lights stays fixed; the other settings (`sampledLights…`) shape the draw, the rays and the filters. Written, the settings named
   *  apply from the next frame — one `null` gives it back its default, one left out stays —; one a setting does not take is refused. */
  get sampledLights(): FamilyValues<'sampledLights'>
  set sampledLights(options: SampledLightsOptions)
  /** The sky's quality settings, each by its field (`WorldOptions`), resolved over the page and the
   *  quality preset: the atmosphere's — `atmosphereOn`, the samples and caps of its marches
   *  (`atmosphereSamplesMin`, `atmosphereSamplesMax`, `skyTableSamplesMax`, `aerialSamplesPerSlice`),
   *  the sizes of its tables and of the haze volume, and its switches (`skyTableFast`,
   *  `atmosphereSampleLightShadowMap`, `multiScatterHighQuality`, `distantSkyLightTable`) —, the
   *  clouds', the light shafts' and the sky light's. Written, the settings named apply from the next
   *  frame over the preset — one `null` gives it back to it, one left out stays —; one a setting
   *  does not take is refused. */
  get skyQuality(): FamilyValues<'skyQuality'>
  set skyQuality(options: SkyQualityOptions)
  /** The tessellation of displaced materials, each setting by its field (`WorldOptions`),
   *  resolved over the page and the quality preset: `tessellation`, whether a material that
   *  names a displacement is cut into micro-triangles and displaced; `tessellationDicingRate`,
   *  their size in pixels; `tessellationMaxPatchesPerGroup`; `tessellationMaxCandidatePatches`
   *  and `tessellationMaxVisiblePatches`, the patches the splitting queue and the visible list
   *  hold; `tessellationShadowsDirectional` and `tessellationShadowsLocal`, whether the displaced
   *  shape is cast into the shadow maps of the suns and of the local lights. Written, the settings named apply from the next frame over the preset — one `null`
   *  gives it back to it, one left out stays —; one a setting does not take is refused. */
  get tessellation(): FamilyValues<'tessellation'>
  set tessellation(options: TessellationOptions)
  /** The texture filtering, each setting by its field (`WorldOptions`), resolved over the page and
   *  the quality preset: `textureMaxAnisotropy`, the most reads anisotropic filtering takes for the
   *  clouds' textures, the only ones not streamed by tile; `virtualTextureMaxAnisotropy`, the same for the textures
   *  streamed by tile, where it also bounds the tiles a pixel asks for (8 each by default; the
   *  presets write 1 and 4, 2 and 4, 4 and 8). Written, the settings named apply from the next image
   *  over the preset — one `null` gives it back to it, one left out stays —; one a setting does not
   *  take is refused. */
  get textureFiltering(): FamilyValues<'textureFiltering'>
  set textureFiltering(options: TextureFilteringOptions)
}
