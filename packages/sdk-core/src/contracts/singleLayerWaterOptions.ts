import {
  choiceSetting as choice,
  contextReader,
  flagSetting as flag,
  integerSetting as integer,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  rulesOf,
  type SettingOptions,
  type SettingValues,
} from './settingRules.ts'

/**
 * The run-time settings of the single-layer water (`packages/sdk-browser/src/blend/water/`): a
 * surface whose material graph wires one of the water outputs (`scatteringCoefficients`,
 * `absorptionCoefficients`, `phaseG`, `colorScaleBehindWater`) is a body of water seen through one
 * layer. It is drawn after the opaque scene, on a copy of the scene's colour and depth taken without it:
 * the water's volume between its surface and the scene behind is integrated analytically (in-scattering
 * of the sun and of the ambient light, colored absorption of what lies behind), what lies behind is read
 * where the refraction moved the pixel (and the pixel's depth where the water is shallow), and the
 * reflections of the surface are traced as the transparents' front layer is. Run-time settings, as
 * `./settingRules.ts` says; each default is the reference's, and the quality levels write none of them.
 *
 * THE SWITCH. `singleLayerWater` turns the whole system off: no water is drawn.
 *
 * THE REFLECTIONS. `singleLayerWaterReflection` picks the technique: `'enabled'`, the one of the rest
 * of the scene (the traced front layer, always on the water however `reflectionFrontLayer` is set);
 * `'disabled'`, no reflection on the water at all; `'captures'`, the reflection captures and the sky
 * only; `'screenSpace'`, the screen's march and the captures, at the full resolution and with no scene ray, no
 * far screen trace, no reconstruction and no spatial filter. The trace of the water's
 * reflections is cast at `singleLayerWaterReflectionDownsample` times fewer pixels a side (1 or 2),
 * (`singleLayerWaterReflectionCheckerboard`: blocks of that many pixels across and one down), with a rebuild from the rays around a pixel (`singleLayerWaterReflectionReconstruction`) and a temporal and spatial
 * denoising (`singleLayerWaterReflectionDenoising`); the screen march's own temporal filter is
 * `singleLayerWaterReflectionTemporal`.
 *
 * THE REFRACTION. What lies behind the water is read on a copy of the scene at
 * `singleLayerWaterRefractionDownsample` times fewer pixels a side (1 or 2). With
 * `singleLayerWaterRefractionCulling`, the pixels where the refraction would show nothing worth the cost are
 * skipped: those farther than `singleLayerWaterRefractionDistanceCulling` metres from the camera, whose Fresnel
 * reflection is above `singleLayerWaterRefractionFresnelCulling`, or where the water is deeper than
 * `singleLayerWaterRefractionDepthCulling` metres, each faded over its own range; a value of 0 leaves that test out.
 *
 * THE SHADOWS. The sun's shadow on the water comes from the shadow maps, read for the water's pixel. The sun's
 * light on the water — its diffuse and specular share and its in-scattering in the volume — is kept apart
 * from the rest (the separated sun) when the distance-field shadow (`singleLayerWaterDistanceFieldShadow`,
 * which needs `singleLayerWaterShadersSupportDistanceFieldShadow`, read when the session opens) or the
 * shadow-map filtering (`singleLayerWaterVsmFiltering`, which needs `singleLayerWaterShadersSupportVsmFiltering`)
 * is on; the composite then lays it over the water multiplied by the sun's distance-field shadow traced at the
 * water's depth, and with the filtering the sun's shadow is the full trace the opaque surfaces get, not one
 * sample. The clouds' shadow on the sun that lights the water's volume is `singleLayerWaterCloudShadow`.
 *
 * THE PASSES. `singleLayerWaterDepthPrepass` draws the water's depth first, `singleLayerWaterTiledComposite`
 * and `singleLayerWaterTiledSceneColorCopy` restrict the reflection composite and the scene copy to the
 * 8 by 8 tiles that hold water, `singleLayerWaterWaveOps` lists those tiles with subgroup operations where the
 * device grants them, and `singleLayerWaterOptimizedClear` copies the scene's depth over the view alone.
 * `singleLayerWaterUnderwaterFogWhenCameraIsAboveWater` lays the height fog on the scene copy behind the water, at the depths of the copy,
 * even when the camera is above the water; the engine has no camera under the water, so it is the only way that fog is laid there.
 *
 * Not ported: `r.Water.SingleLayer.ForceVelocity` (deprecated and ignored by the reference itself),
 * `r.Water.SingleLayer.MobileFallback` and `r.ParallelSingleLayerWaterPass` (a mobile renderer and a
 * render-thread parallelism this engine does not have).
 */

/** The reflection techniques of `singleLayerWaterReflection`, the reference's default first. */
const WATER_REFLECTIONS = ['enabled', 'disabled', 'captures', 'screenSpace'] as const

/** The passes of `singleLayerWaterVelocityOutputPass`, the reference's default first. */
const WATER_VELOCITY_PASSES = ['depthPrepass', 'none', 'basePass'] as const

/** The water's run-time settings by field, each with the reference's default. */
export const SINGLE_LAYER_WATER_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('singleLayerWater', true),
    choice('singleLayerWaterReflection', 'enabled', WATER_REFLECTIONS),
    integer('singleLayerWaterReflectionDownsample', 1, [1, 2]),
    flag('singleLayerWaterReflectionCheckerboard', false),
    flag('singleLayerWaterReflectionReconstruction', false),
    flag('singleLayerWaterReflectionDenoising', false),
    flag('singleLayerWaterReflectionTemporal', true),
    flag('singleLayerWaterTiledComposite', true),
    flag('singleLayerWaterTiledSceneColorCopy', true),
    flag('singleLayerWaterWaveOps', true),
    flag('singleLayerWaterDepthPrepass', true),
    flag('singleLayerWaterOptimizedClear', true),
    flag('singleLayerWaterUnderwaterFogWhenCameraIsAboveWater', false),
    choice('singleLayerWaterVelocityOutputPass', 'depthPrepass', WATER_VELOCITY_PASSES),
    flag('singleLayerWaterShadersSupportDistanceFieldShadow', true),
    flag('singleLayerWaterDistanceFieldShadow', true),
    flag('singleLayerWaterShadersSupportVsmFiltering', false),
    flag('singleLayerWaterVsmFiltering', false),
    flag('singleLayerWaterCloudShadow', false),
    integer('singleLayerWaterRefractionDownsample', 1, [1, 2]),
    flag('singleLayerWaterRefractionCulling', false),
    nonNegative('singleLayerWaterRefractionDistanceCulling', 0),
    nonNegative('singleLayerWaterRefractionDistanceCullingFadeRange', 4),
    number('singleLayerWaterRefractionFresnelCulling', 0, [0, 1]),
    nonNegative('singleLayerWaterRefractionFresnelCullingFadeRange', 0.2),
    nonNegative('singleLayerWaterRefractionDepthCulling', 0),
    nonNegative('singleLayerWaterRefractionDepthCullingFadeRange', 1),
  ] as const))()
/** The field of one setting of the water. */
export type SingleLayerWaterField = keyof typeof SINGLE_LAYER_WATER_RULES
/** The water's settings as a host writes them, by their fields: each its value, or nothing for its
 *  default. */
export type SingleLayerWaterOptions = SettingOptions<typeof SINGLE_LAYER_WATER_RULES>

/** The water setting `field` of a runtime's context (`contextReader`): its default where the context
 *  holds none. */
export const readSingleLayerWaterSetting = /* @__PURE__ */ contextReader(SINGLE_LAYER_WATER_RULES)
/** The water's settings with every field set. */
export type SingleLayerWaterValues = SettingValues<typeof SINGLE_LAYER_WATER_RULES>
