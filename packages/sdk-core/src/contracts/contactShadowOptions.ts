import {
  flagSetting as flag,
  integerSetting as integer,
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
 * - `contactShadowOverrideCastingIntensity` (−1, any number): the intensity every light's shadow has
 *   where the ray meets a surface that casts contact shadows, when it is 0 or more; below 0, the
 *   lights' own. The effective intensity is held to 1 (`writeContactShadow`);
 * - `contactShadowOverrideNonCastingIntensity` (−1, any number): the same where the ray meets one
 *   that does not;
 * - `contactShadowMethod` (0): how the lights' rays are cast: 0 the short stochastic ray every lit pixel casts, 1 the screen-space
 *   shadow of a wavefront marched from each pixel toward the light (Bend), a texture of the light's own made before the lighting;
 * - `contactShadowBendSurfaceThickness` (0.005): how thick the surface a pixel stands for is taken to be when a Bend ray meets it;
 * - `contactShadowIntensityMode` (0): how the Bend shadow's intensity is found: 0 by the hit surface's `castContactShadow` flag, 1 by
 *   its depth, from the non-casting intensity to the casting one over a fade, 2 the casting intensity everywhere;
 * - `contactShadowBendMaxLights` (8, 1 to 16): how many lights the Bend march serves in an image, the suns first then the local lights nearest the eye;
 *   the others cast their stochastic ray. Each costs a layer of the image's size (4 bytes a pixel);
 * - `contactShadowIntensityFadeStart` (1600) and `contactShadowIntensityFadeLength` (800): the depth (centimetres) where that fade
 *   begins and its length, read in mode 1.
 */
export const CONTACT_SHADOW_RULES = /* @__PURE__ */ (() =>
  [
    flag('contactShadows', true),
    number('contactShadowOverrideLength', -1, ANY_NUMBER),
    flag('contactShadowOverrideLengthInWorldSpace', false),
    number('contactShadowOverrideCastingIntensity', -1, ANY_NUMBER),
    number('contactShadowOverrideNonCastingIntensity', -1, ANY_NUMBER),
    integer('contactShadowMethod', 0, [0, 1]),
    number('contactShadowBendSurfaceThickness', 0.005, [0.00001, 1]),
    integer('contactShadowBendMaxLights', 8, [1, 16]),
    integer('contactShadowIntensityMode', 0, [0, 2]),
    number('contactShadowIntensityFadeStart', 1600, [0, 1e9]),
    number('contactShadowIntensityFadeLength', 800, [0.0001, 1e9]),
  ] as const)()

/** The same rules by their field: what the frame reads the view's settings with (`ContactShadowView`). */
export const CONTACT_SHADOW_VIEW_RULES = /* @__PURE__ */ rulesOf(CONTACT_SHADOW_RULES)

/** The field of one contact shadow setting of the view. */
export type ContactShadowField = (typeof CONTACT_SHADOW_RULES)[number]['field']
