import type { ContactShadowField } from '../contracts/contactShadowOptions.ts'

/** What the view's contact shadow settings mean (`../contracts/contactShadowOptions.ts`); a light's
 *  own are `contactShadowLength` and the three fields beside it. */
export const CONTACT_SHADOW_MEANINGS: Readonly<Record<ContactShadowField, string>> = {
  contactShadows:
    "Whether the lights cast contact shadows (true, the default): a ray of eight steps from each lit pixel toward each light through the scene's depth, which darkens the pixel where something stands against it in the light's way. A light casts one if it casts a shadow (and shadowQuality is above 0) and its contactShadowLength (or the override) is above 0. False takes the lights' rays away; a pixel of the eye model (half a centimetre) and one of the hair model under a light with no shadow still cast theirs, and so do the translucent surfaces whose material sets contactShadows.",
  contactShadowOverrideLength:
    "A length, from 0, that replaces the contactShadowLength of every light when it is 0 or more; below 0, the default of -1, the lights' own. 0 turns the lights' contact shadows off. Its unit is the one contactShadowOverrideLengthInWorldSpace says. The eye and hair models' rays do not follow it.",
  contactShadowOverrideLengthInWorldSpace:
    'Whether contactShadowOverrideLength is in metres (true) or in screen units (false, the default): a share of the screen’s height at the pixel’s depth.',
  contactShadowOverrideCastingIntensity:
    "The intensity every light's contact shadow has where its ray meets a surface that casts contact shadows (every surface but an eye's and one of an object that sets castContactShadow to false), when it is 0 or more, held to 1 where it is more; below 0, the default of -1, each light's own contactShadowCastingIntensity.",
  contactShadowOverrideNonCastingIntensity:
    "The intensity every light's contact shadow has where its ray meets a surface that does not cast contact shadows (an eye's, or one of an object that sets castContactShadow to false), when it is 0 or more, held to 1 where it is more; below 0, the default of -1, each light's own contactShadowNonCastingIntensity.",
  contactShadowMethod:
    "How the lights' contact shadows are cast: 0, the default, the short stochastic ray each lit pixel casts toward the light; 1, the Bend screen-space shadow, a texture made before the lighting by marching a wavefront of sixty-four pixels toward each light's place on the screen (about 60 steps, the first four able to shadow alone, the last eight fading).",
  contactShadowBendSurfaceThickness:
    'How thick, from just above 0 to 1, the surface a pixel stands for is taken to be when a Bend ray meets it, as a share of the depth left between the pixel and the far plane: 0.005 by default. A thicker value shadows more, and fainter; used by the method 1 alone.',
  contactShadowBendMaxLights:
    "How many lights the Bend screen-space shadow serves in an image, from 1 to 16: 8 by default. The suns come first, then the local lights nearest the eye; the others cast the short stochastic ray. Each light costs one texture of the image's size (4 bytes a pixel: about 8 MB at 1080p, 33 MB at 4K). Used by the method 1 alone.",
  contactShadowIntensityMode:
    "How the Bend shadow's intensity is found: 0, the default, by the surface the ray hit (contactShadowCastingIntensity if its object casts contact shadows, else contactShadowNonCastingIntensity); 1, by the depth of the shadowed pixel, from the non-casting intensity to the casting one over contactShadowIntensityFadeLength from contactShadowIntensityFadeStart; 2, the casting intensity everywhere. Used by the method 1 alone.",
  contactShadowIntensityFadeStart:
    'The depth, in centimetres, where the Bend shadow starts fading from the non-casting intensity to the casting one: 1600 (16 metres) by default. Read only by contactShadowIntensityMode 1.',
  contactShadowIntensityFadeLength:
    'The length, in centimetres, of that fade: 800 (8 metres) by default, above 0. Read only by contactShadowIntensityMode 1.',
}
