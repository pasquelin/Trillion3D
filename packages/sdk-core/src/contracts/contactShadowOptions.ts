import {
  flagSetting as flag,
  numberSetting as number,
  rulesOf,
  ANY_NUMBER,
} from './settingRules.ts'

/**
 * THE VIEW'S SETTINGS OF THE CONTACT SHADOWS (`shadowOptions.ts` lists them with the others): the
 * short ray every lit pixel casts toward a light through the scene's depth, eight steps long, which
 * finds what stands against the surface in the light's way. A light's own settings are
 * `lightContactShadowOptions.ts`'; a pixel of the eye model casts a ray of half a centimetre toward
 * every light, and one of the hair model a ray of a fifth of the screen's half height at its depth toward
 * every light that casts no shadow, whatever the light and the switch say. Run-time settings, as
 * `./settingRules.ts` says; the quality levels write none of them.
 *
 * - `contactShadows` (on): whether the lights cast their rays; off, the lights cast none and the
 *   eye and hair models still cast theirs;
 * - `contactShadowOverrideLength` (−1): a length that replaces every light's `contactShadowLength`
 *   when it is 0 or more, in the unit `contactShadowOverrideLengthInWorldSpace` says (off: screen
 *   units, on: metres); below 0, the lights' own;
 * - `contactShadowOverrideCastingIntensity` (−1, from −1 to 1): the intensity every light's shadow has
 *   where the ray meets a surface that casts contact shadows, when it is 0 or more; below 0, the
 *   lights' own;
 * - `contactShadowOverrideNonCastingIntensity` (−1, from −1 to 1): the same where the ray meets one
 *   that does not.
 */
export const CONTACT_SHADOW_RULES = /* @__PURE__ */ (() =>
  [
    flag('contactShadows', true),
    number('contactShadowOverrideLength', -1, ANY_NUMBER),
    flag('contactShadowOverrideLengthInWorldSpace', false),
    number('contactShadowOverrideCastingIntensity', -1, [-1, 1]),
    number('contactShadowOverrideNonCastingIntensity', -1, [-1, 1]),
  ] as const)()

/** The same rules by their field: what the frame reads the view's settings with (`ContactShadowView`). */
export const CONTACT_SHADOW_VIEW_RULES = /* @__PURE__ */ rulesOf(CONTACT_SHADOW_RULES)

/** The field of one contact shadow setting of the view. */
export type ContactShadowField = (typeof CONTACT_SHADOW_RULES)[number]['field']
