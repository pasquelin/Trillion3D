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
  castRayTracedShadow:
    "Whether this light's shadow is found by rays through the scene's triangles instead of its shadow maps: 'disabled' never, 'useProjectSetting' (the default) where the view's rayTracedShadows is on, 'enabled' always. Only a device that traces rays through the scene's triangles takes it (hardwareRayTracing), and only the kinds of light the view allows.",
  rayTracedShadowSamplesPerPixel:
    "The rays each pixel casts to this light when its shadow is ray traced, from 1 (the default); more rays soften the penumbra of a light with a size and cost as many traces. The view's rayTracedShadowsSamplesPerPixel overrides it from 0.",
}

/** The light tool's parameter of each contact shadow setting of a light, from its rule: its kind,
 *  default, bounds and what it means. */
export const lightContactShadowProperties = () =>
  ruleProperties(LIGHT_CONTACT_SHADOW_RULES, LIGHT_CONTACT_SHADOW_MEANINGS)
