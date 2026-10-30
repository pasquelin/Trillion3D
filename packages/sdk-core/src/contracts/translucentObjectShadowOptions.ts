import { flagSetting as flag, nonNegativeSetting as nonNegative, rulesOf } from './settingRules.ts'

/**
 * THE TRANSLUCENT OBJECT SHADOWS: the per-object shadows a translucent surface casts into the classic shadow maps of a light
 * (`shadowVirtualEnable` off), a Fourier series of the opacity along the light, added into two float atlases and read back where
 * the light's shadow is projected (`packages/sdk-browser/src/lighting/shadows/perObject/`). Four settings, one place each:
 *
 * - the view's, `translucentObjectShadows` (off): the project switch. Off, no object shadow is made: no pass, no resource, and the
 *   programs of the translucent surfaces hold none of its code;
 * - the light's, `castTranslucentShadows` (on, `Light`, `SceneLight`): the light lets translucent surfaces cast into its shadow;
 * - the object's, `castVolumetricTranslucentShadow` (off, `Object3D`): the object casts a volumetric translucent shadow; it needs the
 *   object to cast a dynamic shadow;
 * - the material's (`Material`): `translucentShadowDensityScale` (0.5) makes its shadow more or less opaque than its opacity
 *   says; `translucentShadowStartOffset` (100 cm) moves where its shadow starts along the light; and, read by the surface from the
 *   sun's shadow of its own object, `translucentSelfShadowDensityScale` (2), `translucentSelfShadowSecondDensityScale` (10),
 *   `translucentSelfShadowSecondOpacity` (0), `translucentBackscatteringExponent` (30) and `translucentMultipleScatteringExtinction`
 *   (1, 0.833, 0.588).
 *
 * Run-time settings, as `./settingRules.ts` says; the quality levels write none of them.
 */
export const TRANSLUCENT_OBJECT_SHADOW_RULES = /* @__PURE__ */ (() =>
  [flag('translucentObjectShadows', false)] as const)()

/** The field of the view's translucent object shadow setting. */
export type TranslucentObjectShadowField = (typeof TRANSLUCENT_OBJECT_SHADOW_RULES)[number]['field']

/** The object's setting: whether it casts a volumetric translucent shadow. */
export const OBJECT_TRANSLUCENT_SHADOW_RULES = /* @__PURE__ */ (() =>
  rulesOf([flag('castVolumetricTranslucentShadow', false)] as const))()

/** The light's setting: whether it lets translucent surfaces cast into its shadow; on. */
export const LIGHT_TRANSLUCENT_SHADOW_DEFAULT = true

/** The material's settings: the density of the shadow its surfaces cast, a scale on its opacity, the start offset of that shadow along the light (centimetres), and
 *  what the surface reads of its own shadow when the sun's is drawn for it: the scale on the density it crosses, a second gradient (its scale and its weight), the exponent
 *  of the backscattering lobe of a subsurface surface, and the extinction the density is divided by, per channel. */
export const MATERIAL_TRANSLUCENT_SHADOW_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    nonNegative('translucentShadowDensityScale', 0.5),
    nonNegative('translucentShadowStartOffset', 100),
    nonNegative('translucentSelfShadowDensityScale', 2),
    nonNegative('translucentSelfShadowSecondDensityScale', 10),
    nonNegative('translucentSelfShadowSecondOpacity', 0),
    nonNegative('translucentBackscatteringExponent', 30),
  ] as const))()

/** The extinction the density a surface reads of its own shadow is divided by, per channel, when it sets none. */
export const TRANSLUCENT_MULTIPLE_SCATTERING_EXTINCTION_DEFAULT = [1, 0.833, 0.588] as const
