import {
  flagSetting as flag,
  integerSetting as integer,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  countSetting as count,
  rulesOf,
  type SettingOptions,
  type SettingValues,
} from './settingRules.ts'

/**
 * The distance-field sky occlusion of a view (`packages/sdk-browser/src/lighting/distanceField/ao/`): how much of
 * the sky each pixel's surface sees, found by tracing nine cones over its hemisphere against the global distance
 * field (`./globalDistanceFieldOptions.ts`) and, near the pixel, against the meshes' own fields; the cones'
 * unoccluded directions sum to a bent normal, which the sky light's diffuse light is read along and its specular light is
 * occluded by (the indirect light's pass: `lighting/deferred/indirectPassWgsl.ts`). It is drawn when the sky light is dynamic,
 * casts shadows, and the bounce is off (with it on, its probes carry the sky and the screen probes its visibility). The
 * light's own settings
 * (`modules/sky/skyLight.ts`: the distance, contrast, exponent, minimum, tint and combine mode) shape what it makes
 * of the bent normal. Each setting is the reference's console variable of the name in the parentheses, with its
 * default; lengths are in the reference's unit, the centimetre, as the sky light's.
 * - `distanceFieldOcclusion` (`r.DistanceFieldAO`, on) and `distanceFieldOcclusionQuality` (`r.AOQuality`, 2): whether
 *   it is allowed, and its method, 0 off, 1 medium (the global field alone), 2 high (the meshes' fields too);
 * - `distanceFieldOcclusionObjects` (`r.AOObjectDistanceField`, on): whether the meshes' fields are traced, at the
 *   high quality, for the first stretch of each cone (`globalDistanceFieldStartDistance`);
 * - `distanceFieldOcclusionStepExponentScale` (`r.AOStepExponentScale`, 0.5): the exponent that spaces the samples
 *   along a cone, in the meshes' fields;
 * - `distanceFieldOcclusionMaxViewDistance` (`r.AOMaxViewDistance`, 20000 cm, held to 65000): the farthest a pixel is
 *   lit by it; past it the sky is unoccluded, faded over the last `1 - distanceFieldOcclusionViewFadeDistanceScale`
 *   of it (`r.AOViewFadeDistanceScale`, 0.7, below 1);
 * - `distanceFieldOcclusionSampleSet` (`r.AOSampleSet`, 1): 0 the original cone directions, 1 the relaxed ones;
 *   `distanceFieldOcclusionJitterConeDirections` (`r.AOJitterConeDirections`, off): turn them by a random angle
 *   each image;
 * - `distanceFieldOcclusionUseJitter` (`r.AOUseJitter`, on): the cones' grid jitters over four images, for four
 *   times the samples once the history has them; `distanceFieldOcclusionTraverseMips` (`r.DistanceFieldAO.TraverseMips`,
 *   on): the cone steps through a mesh's field climb to its coarser mips away from the surface;
 * - `distanceFieldOcclusionUseHistory` (`r.AOUseHistory`, on), `distanceFieldOcclusionHistoryWeight`
 *   (`r.AOHistoryWeight`, 0.85), `distanceFieldOcclusionHistoryDistanceThreshold` (`r.AOHistoryDistanceThreshold`,
 *   30 cm) and `distanceFieldOcclusionHistoryStabilityPass` (`r.AOHistoryStabilityPass`, on; the high quality
 *   only): the temporal filter, the share of the last image it keeps, the distance past which a history value is
 *   another surface's, and the pass that fills the values it dropped from their stable neighbours;
 * - `distanceFieldOcclusionSpecularMode` (`r.AOSpecularOcclusionMode`, 1): 0 occludes the specular light by the bent
 *   normal's length, 1 by the intersection of the reflection cone with the unoccluded one;
 *   `skyLightSpecularOcclusionStrength` (`r.SkySpecularOcclusionStrength`, 1, at least 0.1 where it is used): the
 *   strength of that intersection;
 * - `distanceFieldOcclusionObjectsPerCullTile` (`r.AOAverageObjectsPerCullTile`, 512): the room each screen tile has
 *   for the meshes that reach it.
 */
export const DISTANCE_FIELD_OCCLUSION_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('distanceFieldOcclusion', true),
    integer('distanceFieldOcclusionQuality', 2, [0, 2]),
    flag('distanceFieldOcclusionObjects', true),
    nonNegative('distanceFieldOcclusionStepExponentScale', 0.5),
    nonNegative('distanceFieldOcclusionMaxViewDistance', 20000),
    number('distanceFieldOcclusionViewFadeDistanceScale', 0.7, [0, 0.999999]),
    integer('distanceFieldOcclusionSampleSet', 1, [0, 1]),
    flag('distanceFieldOcclusionJitterConeDirections', false),
    flag('distanceFieldOcclusionUseJitter', true),
    flag('distanceFieldOcclusionTraverseMips', true),
    flag('distanceFieldOcclusionUseHistory', true),
    flag('distanceFieldOcclusionHistoryStabilityPass', true),
    nonNegative('distanceFieldOcclusionHistoryWeight', 0.85),
    nonNegative('distanceFieldOcclusionHistoryDistanceThreshold', 30),
    integer('distanceFieldOcclusionSpecularMode', 1, [0, 1]),
    nonNegative('skyLightSpecularOcclusionStrength', 1),
    count('distanceFieldOcclusionObjectsPerCullTile', 512, 1),
  ] as const))()

/** The fields of the distance-field occlusion's settings. */
export type DistanceFieldOcclusionField = keyof typeof DISTANCE_FIELD_OCCLUSION_RULES

/** What a host writes for the distance-field occlusion: any of its fields. */
export type DistanceFieldOcclusionOptions = SettingOptions<typeof DISTANCE_FIELD_OCCLUSION_RULES>

/** The distance-field occlusion's settings as resolved. */
export type DistanceFieldOcclusionValues = SettingValues<typeof DISTANCE_FIELD_OCCLUSION_RULES>

/** The farthest a pixel's depth is held to: its scene depth is kept in a half float. */
const LARGEST_VIEW_DISTANCE = 65000

/** What the passes read of the settings. */
export interface DistanceFieldOcclusionSettings {
  /** Whether it is allowed at all: the switch on and a quality of 1 or more (`UseDistanceFieldAO`). */
  allowed: boolean
  /** Whether the meshes' fields are traced: the switch on and the high quality (`UseAOObjectDistanceField`). */
  objects: boolean
  /** Whether the history's stability pass runs: its switch and the high quality (`UseAOHistoryStabilityPass`). */
  stabilityPass: boolean
  stepExponentScale: number
  /** The farthest a pixel is lit by it, held to 65000 cm. */
  maxViewDistance: number
  viewFadeDistanceScale: number
  relaxedSampleSet: boolean
  jitterConeDirections: boolean
  useJitter: boolean
  traverseMips: boolean
  useHistory: boolean
  historyWeight: number
  historyDistanceThreshold: number
  specularMode: number
  /** The strength of the specular occlusion, held to the 0.1 under which the reference lifts it. */
  specularStrength: number
  objectsPerCullTile: number
}

/** The occlusion's numbers from its resolved values (`DistanceFieldOcclusionValues`). */
export function resolveDistanceFieldOcclusion(
  values: DistanceFieldOcclusionValues,
): DistanceFieldOcclusionSettings {
  const quality = values.distanceFieldOcclusionQuality
  return {
    allowed: values.distanceFieldOcclusion && quality >= 1,
    objects: values.distanceFieldOcclusionObjects && quality >= 2,
    stabilityPass: values.distanceFieldOcclusionHistoryStabilityPass && quality >= 2,
    stepExponentScale: values.distanceFieldOcclusionStepExponentScale,
    maxViewDistance: Math.min(values.distanceFieldOcclusionMaxViewDistance, LARGEST_VIEW_DISTANCE),
    viewFadeDistanceScale: values.distanceFieldOcclusionViewFadeDistanceScale,
    relaxedSampleSet: values.distanceFieldOcclusionSampleSet !== 0,
    jitterConeDirections: values.distanceFieldOcclusionJitterConeDirections,
    useJitter: values.distanceFieldOcclusionUseJitter,
    traverseMips: values.distanceFieldOcclusionTraverseMips,
    useHistory: values.distanceFieldOcclusionUseHistory,
    historyWeight: values.distanceFieldOcclusionHistoryWeight,
    historyDistanceThreshold: values.distanceFieldOcclusionHistoryDistanceThreshold,
    specularMode: values.distanceFieldOcclusionSpecularMode,
    specularStrength: Math.max(values.skyLightSpecularOcclusionStrength, 0.1),
    objectsPerCullTile: values.distanceFieldOcclusionObjectsPerCullTile,
  }
}
