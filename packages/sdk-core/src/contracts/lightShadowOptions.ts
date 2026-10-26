import { fieldsOf, refusal } from './nameMatch.ts'
import {
  countSetting as count,
  distanceSetting as distance,
  flagSetting as flag,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  resolveSettings,
  rulesOf,
  type SettingOptions,
  type SettingValues,
} from './settingRules.ts'

/**
 * THE SHADOWS OF A DIRECTIONAL LIGHT, the settings of the light itself, one for each rule below
 * (`LIGHT_SHADOW_RULES`, the one source of their names, kinds and defaults): its fields on the
 * light's record (`SceneLight`), its properties (`Light`), the light tool's parameters. They are a
 * directional light's alone. A light whose any of them changes is made again, its cached shadow
 * pages dropped, as the light a new `shadowDistance` makes (`lightCache.ts`). The view's settings
 * that shape the same shadows are `shadowOptions.ts`'; what they make of them, the far-shadow edge
 * and the distance-field cascade, `sunCascades.ts`.
 *
 * - `shadowDistance` (400 metres): how far from the eye the light's shadow maps are asked to
 *   reach; `true` is the default, `false` none;
 * - `shadowCascades` (4): the near levels it is cut into, at most the view's `shadowNearLevels`;
 *   `shadowCascadeExponent` (3): how many times the span of the one before each takes;
 *   `shadowCascadeTransition` (0.1): the share of its span a level overlaps into the next;
 * - `farShadowCascades` (0) and `farShadowDistance` (3000 metres): the levels between its distance
 *   and this one, valid while the far distance is past the shadow distance by more than a metre;
 * - `distanceFieldShadows` (on): whether the distance-field cascade is made, from the near levels'
 *   end to `distanceFieldShadowDistance` (512 metres), `true` the default, `false` none;
 *   `distanceFieldTraceDistance` (100 metres, from 10 to 10 000): how far a ray of it goes;
 *   `distanceFieldRayStartOffset` (0.003): the share of a pixel's depth its rays start off the
 *   surface by;
 * - `shadowAmount` (1, from 0 to 1): how dark the shadow of the distance-field cascade is, the share
 *   of it that reaches the light's light (0: no shadow from it). Not part of the clipmap's cache key.
 */
export const LIGHT_SHADOW_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    distance('shadowDistance', 400),
    count('shadowCascades', 4, 0),
    nonNegative('shadowCascadeExponent', 3),
    nonNegative('shadowCascadeTransition', 0.1),
    count('farShadowCascades', 0, 0),
    distance('farShadowDistance', 3000),
    flag('distanceFieldShadows', true),
    distance('distanceFieldShadowDistance', 512),
    number('distanceFieldTraceDistance', 100, [10, 10000]),
    nonNegative('distanceFieldRayStartOffset', 0.003),
    number('shadowAmount', 1, [0, 1]),
  ] as const))()

/** The field of one shadow setting of a light. */
export type LightShadowField = keyof typeof LIGHT_SHADOW_RULES
/** The fields of a light's shadow settings, in the rules' order. */
export const LIGHT_SHADOW_FIELDS = /* @__PURE__ */ Object.keys(
  LIGHT_SHADOW_RULES,
) as readonly LightShadowField[]
/** What a host writes for a light's shadows: any of its fields, or nothing for its default. */
export type LightShadowOptions = SettingOptions<typeof LIGHT_SHADOW_RULES>
/** A light's shadow settings, every field set. */
export type LightShadow = SettingValues<typeof LIGHT_SHADOW_RULES>
/** A shadow distance as a host writes it: metres, `true` the default, `false` none. */
export type ShadowDistanceOption = LightShadowOptions['shadowDistance']
/** The shadow distance a directional light has when it names none, in metres. */
export const SHADOW_DISTANCE_DEFAULT = /* @__PURE__ */ (() =>
  LIGHT_SHADOW_RULES.shadowDistance.default)()

/** The settings `fields` name, each as its rule takes it, the others at their defaults.
 *  @throws TypeError naming a field a light does not have, or a value a field does not take. */
export const resolveLightShadow = (fields: Readonly<Record<string, unknown>>): LightShadow =>
  resolveSettings(
    LIGHT_SHADOW_RULES,
    fieldsOf(fields, LIGHT_SHADOW_FIELDS, 'the shadows of a light', refusal('light shadow')),
  )
