import type { ContactShadowField } from '../contracts/contactShadowOptions.ts'

/** What the view's contact shadow settings mean (`../contracts/contactShadowOptions.ts`); a light's
 *  own are `contactShadowLength` and the three fields beside it. */
export const CONTACT_SHADOW_MEANINGS: Readonly<Record<ContactShadowField, string>> = {
  contactShadows:
    "Whether the lights cast contact shadows (true, the default): a ray of eight steps from each lit pixel toward each light through the scene's depth, which darkens the pixel where something stands against it in the light's way. A light casts one if it casts a shadow and its contactShadowLength (or the override) is above 0. False takes the lights' rays away; a pixel of the eye model (half a centimetre) and one of the hair model under a light with no shadow still cast theirs.",
  contactShadowOverrideLength:
    "A length, from 0, that replaces the contactShadowLength of every light when it is 0 or more; below 0, the default of -1, the lights' own. 0 turns the lights' contact shadows off. Its unit is the one contactShadowOverrideLengthInWorldSpace says. The eye and hair models' rays do not follow it.",
  contactShadowOverrideLengthInWorldSpace:
    'Whether contactShadowOverrideLength is in metres (true) or in screen units (false, the default): a share of the screen’s height at the pixel’s depth.',
  contactShadowOverrideCastingIntensity:
    "The intensity, from 0 to 1, every light's contact shadow has where its ray meets a surface that casts contact shadows (every surface but an eye's), when it is 0 or more; below 0, the default of -1, each light's own contactShadowCastingIntensity.",
  contactShadowOverrideNonCastingIntensity:
    "The intensity, from 0 to 1, every light's contact shadow has where its ray meets a surface that does not cast contact shadows (an eye's), when it is 0 or more; below 0, the default of -1, each light's own contactShadowNonCastingIntensity.",
}
