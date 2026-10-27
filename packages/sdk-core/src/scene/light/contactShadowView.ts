import type { LightContactShadow } from '../../contracts/lightContactShadowOptions.ts'
import type { SceneLight } from './contracts.ts'
import { contactShadowOfLight } from './lightContactShadow.ts'

/** The view's contact shadow settings (`../../contracts/contactShadowOptions.ts`, by their fields): the
 *  switch, and each override of the lights' own — a length with its unit, the two intensities —, below 0
 *  for none. */
export interface ContactShadowView {
  contactShadows: boolean
  contactShadowOverrideLength: number
  contactShadowOverrideLengthInWorldSpace: boolean
  contactShadowOverrideCastingIntensity: number
  contactShadowOverrideNonCastingIntensity: number
}

/** The view that overrides nothing and keeps the contact shadows on. */
export const NO_CONTACT_SHADOW_VIEW: Readonly<ContactShadowView> = /* @__PURE__ */ Object.freeze({
  contactShadows: true,
  contactShadowOverrideLength: -1,
  contactShadowOverrideLengthInWorldSpace: false,
  contactShadowOverrideCastingIntensity: -1,
  contactShadowOverrideNonCastingIntensity: -1,
})

const casting = (own: LightContactShadow, view: ContactShadowView) =>
  view.contactShadowOverrideCastingIntensity >= 0
    ? view.contactShadowOverrideCastingIntensity
    : own.contactShadowCastingIntensity
const nonCasting = (own: LightContactShadow, view: ContactShadowView) =>
  view.contactShadowOverrideNonCastingIntensity >= 0
    ? view.contactShadowOverrideNonCastingIntensity
    : own.contactShadowNonCastingIntensity

/** Whether a light's ray, folded with the view, can darken anything: the switch is on, its length is above
 *  0 and one of its two intensities is. */
function rays(own: LightContactShadow, view: ContactShadowView) {
  if (!view.contactShadows) return false
  const length =
    view.contactShadowOverrideLength >= 0
      ? view.contactShadowOverrideLength
      : own.contactShadowLength
  return length > 0 && (casting(own, view) > 0 || nonCasting(own, view) > 0)
}

/**
 * Writes at `at` of `packed` a light's contact shadow (`own`, its settings) as the lit passes read it
 * (`LIGHT_FIELD.contactGi`: three lanes), its settings replaced by the view's as the reference builds a
 * light's data: the length, negative when it is in metres and doubled when it is in screen units — the
 * shader multiplies it by the tangent of half the field times the depth, which spans half the screen's
 * height, so a screen length is a share of the whole height —, then the intensity at a surface that
 * casts contact shadows and at one that does not. The length that of the view's override when it is 0
 * or more, with the override's unit. With the switch off, or no intensity above 0, no ray: a length of 0
 * (the intensities 1 and 0 with the switch off).
 */
export function writeContactShadow(
  packed: Float32Array,
  at: number,
  own: LightContactShadow,
  view: ContactShadowView,
) {
  const off = !view.contactShadows
  const overridden = view.contactShadowOverrideLength >= 0
  const length = overridden ? view.contactShadowOverrideLength : own.contactShadowLength
  const metres = overridden
    ? view.contactShadowOverrideLengthInWorldSpace
    : own.contactShadowLengthInWorldSpace
  // `0 - length`, not `-length`: a length of 0 in metres stays +0.
  packed[at] = rays(own, view) ? (metres ? 0 - length : 2 * length) : 0
  packed[at + 1] = off ? 1 : casting(own, view)
  packed[at + 2] = off ? 0 : nonCasting(own, view)
}

/** Whether a light casts a ray of its own under `view`: it casts a shadow and its folded ray can darken
 *  (`writeContactShadow`). */
export const castsContactShadow = (light: SceneLight, view: ContactShadowView) =>
  light.castsShadow && rays(contactShadowOfLight(light), view)
