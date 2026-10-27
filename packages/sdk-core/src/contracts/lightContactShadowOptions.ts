import { fieldsOf, refusal } from './nameMatch.ts'
import {
  flagSetting as flag,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  resolveSettings,
  rulesOf,
  type SettingOptions,
  type SettingValues,
} from './settingRules.ts'

/**
 * THE CONTACT SHADOWS OF A LIGHT, and its indirect lighting factor: the settings of the light itself,
 * one for each rule below (`LIGHT_CONTACT_SHADOW_RULES`, the one source of their names, kinds and
 * defaults): its fields on the light's record (`SceneLight`), its properties (`Light`), the light
 * tool's parameters. Every kind of light has them. A contact shadow is a short ray from the pixel toward the light through
 * the scene's depth, eight steps long, which finds what stands against the surface in the light's
 * way (`packages/sdk-browser/src/lighting/contactShadow/contactShadowWgsl.ts`); the view's
 * settings that switch or override them are `contactShadowOptions.ts`'.
 *
 * - `contactShadowLength` (0): the length of the ray; 0 casts none. Read in screen units — a share of
 *   the screen's height at the pixel's depth, about 0.01 for a sharp contact — unless
 *   `contactShadowLengthInWorldSpace`; only a light that casts a shadow casts one;
 * - `contactShadowLengthInWorldSpace` (off): the length is in metres;
 * - `contactShadowCastingIntensity` (1, from 0 to 1): how dark the shadow is where the ray meets a
 *   surface that casts contact shadows (every surface but an eye's); 0 none, 1 whole;
 * - `contactShadowNonCastingIntensity` (0, from 0 to 1): how dark it is where it meets one that does
 *   not;
 * - `indirectLightingIntensity` (1, from 0): the factor on the light the light gives the scene's
 *   indirect lighting; the light's record holds it beside the contact shadows' numbers
 *   (`LIGHT_FIELD.contactGi`).
 */
export const LIGHT_CONTACT_SHADOW_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    nonNegative('contactShadowLength', 0),
    flag('contactShadowLengthInWorldSpace', false),
    number('contactShadowCastingIntensity', 1, [0, 1]),
    number('contactShadowNonCastingIntensity', 0, [0, 1]),
    nonNegative('indirectLightingIntensity', 1),
  ] as const))()

/** The field of one contact shadow setting of a light. */
export type LightContactShadowField = keyof typeof LIGHT_CONTACT_SHADOW_RULES
/** The fields of a light's contact shadow settings, in the rules' order. */
const LIGHT_CONTACT_SHADOW_FIELDS = /* @__PURE__ */ Object.keys(
  LIGHT_CONTACT_SHADOW_RULES,
) as readonly LightContactShadowField[]
/** What a host writes for a light's contact shadows: any of its fields, or nothing for its default. */
export type LightContactShadowOptions = SettingOptions<typeof LIGHT_CONTACT_SHADOW_RULES>
/** A light's contact shadow settings, every field set. */
export type LightContactShadow = SettingValues<typeof LIGHT_CONTACT_SHADOW_RULES>

/** The settings `fields` name, each as its rule takes it, the others at their defaults.
 *  @throws TypeError naming a field a light does not have, or a value a field does not take. */
export const resolveLightContactShadow = (
  fields: Readonly<Record<string, unknown>>,
): LightContactShadow =>
  resolveSettings(
    LIGHT_CONTACT_SHADOW_RULES,
    fieldsOf(
      fields,
      LIGHT_CONTACT_SHADOW_FIELDS,
      'the contact shadows of a light',
      refusal('light contact shadow'),
    ),
  )
