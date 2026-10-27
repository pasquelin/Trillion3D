import type {
  HlodWarmupOptions,
  WorldStreamingOptions,
} from '../../../sdk-core/src/contracts/worldStreamingOptions.ts'
import type { CutOptions } from '../../../sdk-core/src/contracts/cutOptions.ts'
import type { DynamicResolutionOptions } from '../../../sdk-core/src/contracts/dynamicResolutionOptions.ts'
import type { AnimationOptions } from '../../../sdk-core/src/contracts/animationOptions.ts'
import type { ShadingOptions } from '../../../sdk-core/src/contracts/shadingOptions.ts'
import type { ExposureCurveOptions } from '../../../sdk-core/src/contracts/exposureCurve.ts'
import type { ExposureMeterMaskOptions } from '../../../sdk-core/src/contracts/exposureMeterMask.ts'
import type { ExposureOptions } from '../../../sdk-core/src/contracts/exposureOptions.ts'
import type { TemporalOptions } from '../../../sdk-core/src/contracts/temporalOptions.ts'
import type { HizOptions } from '../../../sdk-core/src/contracts/hizOptions.ts'
import type { LightFunctionOptions } from '../../../sdk-core/src/contracts/lightFunctionOptions.ts'
import type { VolumetricLightmapOptions } from '../../../sdk-core/src/contracts/volumetricLightmapOptions.ts'
import type { DistanceFieldOcclusionOptions } from '../../../sdk-core/src/contracts/distanceFieldOcclusionOptions.ts'
import type { GlobalDistanceFieldOptions } from '../../../sdk-core/src/contracts/globalDistanceFieldOptions.ts'
import type { SurfaceCacheOptions } from '../../../sdk-core/src/contracts/surfaceCacheOptions.ts'
import type { ShadowOptions } from '../../../sdk-core/src/contracts/shadowOptions.ts'
import type { MotionBlurSettings } from '../../../sdk-core/src/contracts/motionBlurOptions.ts'
import type { DepthOfFieldSettings } from '../../../sdk-core/src/contracts/depthOfFieldRules.ts'
import type { BloomSettings } from '../../../sdk-core/src/contracts/bloomRules.ts'
import type { GaussianBlurSettings } from '../../../sdk-core/src/contracts/gaussianBlurRules.ts'
import type { FilmSettings } from '../../../sdk-core/src/contracts/filmOptions.ts'
import type { ColorGradingSettings } from '../../../sdk-core/src/contracts/colorGradingOptions.ts'
import type { AmbientOcclusionOptions } from '../../../sdk-core/src/contracts/ambientOcclusionOptions.ts'
import type { AmbientCubemapOptions } from '../../../sdk-core/src/contracts/ambientCubemapOptions.ts'
import type { SkyQualityOptions } from '../../../sdk-core/src/modules/sky/quality.ts'
import type { ScreenProbeOptions } from '../../../sdk-core/src/bounce/screenProbeOptions.ts'
import type { ReflectionOptions } from '../../../sdk-core/src/contracts/reflectionOptions.ts'
import type { VolumetricFogOptions } from '../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import type { SingleLayerWaterOptions } from '../../../sdk-core/src/contracts/singleLayerWaterOptions.ts'
import type { SubsurfaceScatteringOptions } from '../../../sdk-core/src/contracts/subsurfaceScatteringOptions.ts'
import type { TranslucencyVolumeOptions } from '../../../sdk-core/src/contracts/translucencyVolumeOptions.ts'
import type { TranslucencyGiOptions } from '../../../sdk-core/src/contracts/translucencyGiOptions.ts'
import type { HairStrandsOptions } from '../../../sdk-core/src/contracts/hairStrandsOptions.ts'
import type { TessellationOptions } from '../../../sdk-core/src/contracts/tessellationOptions.ts'
import type { RasterOptions } from '../../../sdk-core/src/contracts/rasterOptions.ts'
import type { StreamingOptions } from '../../../sdk-core/src/contracts/streamingOptions.ts'

/**
 * Every setting an option contract of the core gives a world, each by its own fields with its
 * name, default and range (`../../../sdk-core/src/contracts`): what a page names when it creates a
 * world (`WorldOptions`), what its session carries (`MeasuredWorldOptions`) and what an engine is
 * built on (`EngineContext`).
 */
export interface SettingOptions
  extends
    WorldStreamingOptions,
    HlodWarmupOptions,
    CutOptions,
    DynamicResolutionOptions,
    AnimationOptions,
    ShadingOptions,
    ExposureOptions,
    ExposureCurveOptions,
    ExposureMeterMaskOptions,
    TemporalOptions,
    HizOptions,
    LightFunctionOptions,
    VolumetricLightmapOptions,
    GlobalDistanceFieldOptions,
    SurfaceCacheOptions,
    DistanceFieldOcclusionOptions,
    ShadowOptions,
    MotionBlurSettings,
    DepthOfFieldSettings,
    BloomSettings,
    GaussianBlurSettings,
    FilmSettings,
    ColorGradingSettings,
    VolumetricFogOptions,
    TranslucencyVolumeOptions,
    TranslucencyGiOptions,
    SubsurfaceScatteringOptions,
    SingleLayerWaterOptions,
    HairStrandsOptions,
    TessellationOptions,
    ScreenProbeOptions,
    ReflectionOptions,
    AmbientOcclusionOptions,
    AmbientCubemapOptions,
    SkyQualityOptions,
    RasterOptions,
    StreamingOptions {}
