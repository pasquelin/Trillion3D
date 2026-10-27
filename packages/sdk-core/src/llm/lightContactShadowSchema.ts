import {
  LIGHT_CONTACT_SHADOW_RULES,
  type LightContactShadowField,
} from '../contracts/lightContactShadowOptions.ts'
import { ruleProperties } from './settingProperties.ts'

/** What each contact shadow setting of a light means (`../contracts/lightContactShadowOptions.ts`). */
const LIGHT_CONTACT_SHADOW_MEANINGS: Readonly<Record<LightContactShadowField, string>> = {
  contactShadowLength:
    "The length of the contact shadow ray this light's pixels cast toward it through the scene's depth, to find what stands against a surface in its way; 0, the default, casts none. In screen units — a share of the screen's height at the pixel's depth — unless contactShadowLengthInWorldSpace. Only a light that casts a shadow (castsShadow) casts one. The view's contactShadows switches the lights' rays off.",
  contactShadowLengthInWorldSpace:
    'Whether contactShadowLength is in meters (true) rather than in screen units (false, the default).',
  contactShadowCastingIntensity:
    'How dark the contact shadow is, from 0 (none) to 1 (the default, whole), where its ray meets a surface that casts contact shadows: every surface but an eye.',
  contactShadowNonCastingIntensity:
    'How dark the contact shadow is, from 0 (the default, none) to 1 (whole), where its ray meets a surface that does not cast contact shadows: an eye.',
  indirectLightingIntensity:
    "The factor on the light this light gives the scene's indirect lighting, from 0; 1, the default, leaves it as the light's colour and intensity make it, 0 gives the indirect lighting none.",
}

/** The light tool's parameter of each contact shadow setting of a light, from its rule: its kind,
 *  default, bounds and what it means. */
export const lightContactShadowProperties = () =>
  ruleProperties(LIGHT_CONTACT_SHADOW_RULES, LIGHT_CONTACT_SHADOW_MEANINGS)
