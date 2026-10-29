import { ANIMATION_RULES } from '../contracts/animationOptions.ts'
import { AMBIENT_OCCLUSION_RULES } from '../contracts/ambientOcclusionOptions.ts'
import { AMBIENT_CUBEMAP_RULES } from '../contracts/ambientCubemapOptions.ts'
import { REFLECTION_CAPTURE_RULES } from '../contracts/reflectionCaptureOptions.ts'
import { BLOOM_RULES } from '../contracts/bloomRules.ts'
import { COLOR_GRADING_RULES } from '../contracts/colorGradingOptions.ts'
import { CUT_RULES } from '../contracts/cutOptions.ts'
import { DEPTH_OF_FIELD_RULES } from '../contracts/depthOfFieldRules.ts'
import { DISTANCE_FIELD_OCCLUSION_RULES } from '../contracts/distanceFieldOcclusionOptions.ts'
import { DYNAMIC_RESOLUTION_RULES } from '../contracts/dynamicResolutionOptions.ts'
import { EXPOSURE_RULES } from '../contracts/exposureOptions.ts'
import { FILM_RULES } from '../contracts/filmOptions.ts'
import { GAUSSIAN_BLUR_RULES } from '../contracts/gaussianBlurRules.ts'
import { GLOBAL_DISTANCE_FIELD_RULES } from '../contracts/globalDistanceFieldOptions.ts'
import { HAIR_STRANDS_RULES } from '../contracts/hairStrandsOptions.ts'
import { HETEROGENEOUS_VOLUME_RULES } from '../contracts/heterogeneousVolumeOptions.ts'
import { HIZ_RULES } from '../contracts/hizOptions.ts'
import { LIGHT_FUNCTION_RULES } from '../contracts/lightFunctionOptions.ts'
import { LIGHT_PROFILE_RULES } from '../contracts/lightProfileOptions.ts'
import { RECT_LIGHT_ATLAS_RULES } from '../contracts/rectLightAtlasOptions.ts'
import { MOTION_BLUR_RULES } from '../contracts/motionBlurOptions.ts'
import { RASTER_RULES } from '../contracts/rasterOptions.ts'
import { REFLECTION_RULES } from '../contracts/reflectionOptions.ts'
import { LIGHTING_DATA_FORMAT_RULES } from '../contracts/lightingDataFormatOptions.ts'
import { MESH_DISTANCE_FIELD_TRACE_RULES } from '../contracts/meshDistanceFieldTraceOptions.ts'
import { SCREEN_SPACE_TRACING_RULES } from '../contracts/screenSpaceTracingOptions.ts'
import { SINGLE_LAYER_WATER_RULES } from '../contracts/singleLayerWaterOptions.ts'
import { SHADING_RULES } from '../contracts/shadingOptions.ts'
import { SAMPLED_LIGHTS_RULES } from '../contracts/sampledLightsOptions.ts'
import { PATH_TRACING_RULES } from '../contracts/pathTracingOptions.ts'
import { SHADOW_RULES } from '../contracts/shadowOptions.ts'
import type { SettingRule, SettingValues } from '../contracts/settingRules.ts'
import { SUBSURFACE_SCATTERING_RULES } from '../contracts/subsurfaceScatteringOptions.ts'
import { STREAMING_RULES } from '../contracts/streamingOptions.ts'
import { SURFACE_CACHE_RULES } from '../contracts/surfaceCacheOptions.ts'
import { TEMPORAL_RULES } from '../contracts/temporalOptions.ts'
import { TEXTURE_FILTERING_RULES } from '../contracts/textureFilteringOptions.ts'
import { TESSELLATION_RULES } from '../contracts/tessellationOptions.ts'
import { TRANSLUCENCY_VOLUME_RULES } from '../contracts/translucencyVolumeOptions.ts'
import { TRANSLUCENCY_GI_RULES } from '../contracts/translucencyGiOptions.ts'
import { VOLUMETRIC_FOG_RULES } from '../contracts/volumetricFogOptions.ts'
import { VOLUMETRIC_LIGHTMAP_RULES } from '../contracts/volumetricLightmapOptions.ts'
import { WORLD_STREAMING_RULES } from '../contracts/worldStreamingOptions.ts'
import { SCREEN_PROBE_RULES } from '../bounce/screenProbeOptions.ts'
import { SKY_QUALITY_RULES, SKY_QUALITY_RULES_BY_GROUP } from '../modules/sky/quality.ts'
import type { UnionToIntersection } from './joined.ts'
import type { QualityGroup } from './renderSettings.ts'

/** The rules the world's registry holds: every kind but a vector, which no registry entry types. */
export type RegistryRule = Exclude<SettingRule, { readonly kind: 'vector' }>
/** A family's rules, by field. */
export type FamilyRules = Readonly<Record<string, RegistryRule>>

/**
 * What a family of settings declared by rule is, beside its rules, for every surface that lists
 * the families: the world's registry (`group`, `groups`), its accessors (`member`, `world`) and the
 * session's writers, which `setterOf` names.
 */
interface SettingFamily {
  /** The family's settings, by field. */
  readonly rules: FamilyRules
  /** The quality group whose levels write the family's settings in the registry; `null` where the
   *  family spreads over several (`groups`). */
  readonly group: QualityGroup | null
  /** The family's rules by the quality group whose levels write them, where it has more than one. */
  readonly groups?: Readonly<Partial<Record<QualityGroup, FamilyRules>>>
  /** The name of its accessor on the world when it is not the family's own. */
  readonly member?: string
  /** Which of the world's two documented accessor interfaces carries it (`worldSceneTypes.ts`,
   *  `worldImageTypes.ts`); none for a family the world reads only to open a session. */
  readonly world?: 'scene' | 'image'
  /** The family's settings are written by a method of their own each, not by `setterOf` its name
   *  taking `(field, value)`: the cluster raster's two (`session/world/ruledSwitches.ts`,
   *  `api/ruleApi.ts`). */
  readonly named?: true
}
/** A table of families by name. */
export type FamilyTable = Readonly<Record<string, SettingFamily>>

/**
 * THE FAMILIES OF SETTINGS DECLARED BY RULE, one row each, in the order they are read and written.
 * The world's registry entries (`session/world/settings.ts`), its switches (`ruledSwitches.ts`)
 * and accessors (`worldFamilySettings.ts`), the session's writers (`api/ruleApi.ts`) and the
 * options the engine's context is resolved from (`session/engine.ts`) are all made from this
 * list: a new family is one row here, and its documented types.
 */
export const SETTING_FAMILIES = {
  raster: { rules: RASTER_RULES, group: 'viewDistance', named: true },
  streaming: { rules: STREAMING_RULES, group: 'viewDistance' },
  worldStreaming: { rules: WORLD_STREAMING_RULES, group: 'viewDistance', world: 'scene' },
  cut: { rules: CUT_RULES, group: 'viewDistance', world: 'scene' },
  dynamicResolution: { rules: DYNAMIC_RESOLUTION_RULES, group: 'viewDistance', world: 'scene' },
  animation: { rules: ANIMATION_RULES, group: 'viewDistance', world: 'scene' },
  shading: { rules: SHADING_RULES, group: 'viewDistance', world: 'image' },
  exposure: {
    rules: EXPOSURE_RULES,
    group: 'viewDistance',
    member: 'exposureSettings',
    world: 'image',
  },
  temporal: { rules: TEMPORAL_RULES, group: 'edgeSmoothing', world: 'image' },
  hiz: { rules: HIZ_RULES, group: 'viewDistance', world: 'image' },
  lightFunction: { rules: LIGHT_FUNCTION_RULES, group: 'viewDistance', world: 'image' },
  lightProfile: { rules: LIGHT_PROFILE_RULES, group: 'shadows', world: 'image' },
  rectLightAtlas: { rules: RECT_LIGHT_ATLAS_RULES, group: 'shadows', world: 'image' },
  volumetricLightmap: { rules: VOLUMETRIC_LIGHTMAP_RULES, group: 'viewDistance', world: 'image' },
  globalDistanceField: {
    rules: GLOBAL_DISTANCE_FIELD_RULES,
    group: 'viewDistance',
    world: 'image',
  },
  distanceFieldOcclusion: {
    rules: DISTANCE_FIELD_OCCLUSION_RULES,
    group: 'viewDistance',
    world: 'image',
  },
  shadows: { rules: SHADOW_RULES, group: 'shadows', world: 'image' },
  sampledLights: { rules: SAMPLED_LIGHTS_RULES, group: 'shadows', world: 'image' },
  pathTracing: { rules: PATH_TRACING_RULES, group: 'indirectLight', world: 'image' },
  indirectLight: { rules: SCREEN_PROBE_RULES, group: 'indirectLight', world: 'image' },
  reflections: { rules: REFLECTION_RULES, group: 'indirectLight', world: 'image' },
  screenSpaceTracing: { rules: SCREEN_SPACE_TRACING_RULES, group: 'indirectLight', world: 'image' },
  lightingDataFormat: { rules: LIGHTING_DATA_FORMAT_RULES, group: 'indirectLight', world: 'image' },
  meshDistanceFieldTrace: {
    rules: MESH_DISTANCE_FIELD_TRACE_RULES,
    group: 'indirectLight',
    world: 'image',
  },
  surfaceCache: { rules: SURFACE_CACHE_RULES, group: 'indirectLight', world: 'image' },
  volumetricFog: { rules: VOLUMETRIC_FOG_RULES, group: 'shadows', world: 'image' },
  subsurfaceScattering: { rules: SUBSURFACE_SCATTERING_RULES, group: 'effects', world: 'image' },
  translucencyVolume: { rules: TRANSLUCENCY_VOLUME_RULES, group: 'effects', world: 'image' },
  translucencyGi: { rules: TRANSLUCENCY_GI_RULES, group: 'indirectLight', world: 'image' },
  singleLayerWater: { rules: SINGLE_LAYER_WATER_RULES, group: 'effects', world: 'image' },
  hairStrands: { rules: HAIR_STRANDS_RULES, group: 'effects', world: 'image' },
  heterogeneousVolumeRendering: {
    rules: HETEROGENEOUS_VOLUME_RULES,
    group: 'effects',
    world: 'image',
  },
  tessellation: { rules: TESSELLATION_RULES, group: 'viewDistance', world: 'image' },
  textureFiltering: { rules: TEXTURE_FILTERING_RULES, group: 'textures', world: 'image' },
  motionBlur: { rules: MOTION_BLUR_RULES, group: 'imageEffects', world: 'image' },
  depthOfField: { rules: DEPTH_OF_FIELD_RULES, group: 'imageEffects', world: 'image' },
  bloom: { rules: BLOOM_RULES, group: 'imageEffects', world: 'image' },
  gaussianBlur: { rules: GAUSSIAN_BLUR_RULES, group: 'imageEffects', world: 'image' },
  film: { rules: FILM_RULES, group: 'imageEffects', world: 'image' },
  colorGrading: { rules: COLOR_GRADING_RULES, group: 'imageEffects', world: 'image' },
  ambientOcclusion: { rules: AMBIENT_OCCLUSION_RULES, group: 'imageEffects', world: 'image' },
  ambientCubemap: { rules: AMBIENT_CUBEMAP_RULES, group: 'indirectLight', world: 'image' },
  reflectionCapture: { rules: REFLECTION_CAPTURE_RULES, group: 'indirectLight', world: 'image' },
  skyQuality: {
    rules: SKY_QUALITY_RULES,
    group: null,
    groups: SKY_QUALITY_RULES_BY_GROUP,
    world: 'image',
  },
} as const satisfies FamilyTable

/** A family of `SETTING_FAMILIES`. */
export type FamilyName = keyof typeof SETTING_FAMILIES
/** The settings of the family `N`, resolved: every field its value. */
export type FamilyValues<N extends FamilyName> = SettingValues<
  (typeof SETTING_FAMILIES)[N]['rules']
>

/** The settings of every family, resolved, by field: what the engine's context holds of them. */
export type AllFamilyValues = UnionToIntersection<
  { [N in FamilyName]: FamilyValues<N> }[FamilyName]
>

/** The name of the family `name`'s accessor on the world. */
export const memberOf = (name: string, table: FamilyTable = SETTING_FAMILIES) =>
  table[name].member ?? name
/** The name of the session's writer of the family `name`: `setCut` for `cut`. */
export const setterOf = (name: string) => `set${name.charAt(0).toUpperCase()}${name.slice(1)}`
