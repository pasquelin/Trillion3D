import { LIGHT_SHAFT_LIGHT_RULES } from '../modules/sky/lightShafts.ts'
import { ruleProperties } from './settingProperties.ts'

/** What each light shaft setting of a light means (`../modules/sky/lightShafts.ts`). */
const LIGHT_SHAFT_MEANINGS: Readonly<Record<keyof typeof LIGHT_SHAFT_LIGHT_RULES, string>> = {
  shaftOcclusion:
    "Directional only: whether this light darkens the fog's inscattering where the scene hides it (light shafts).",
  shaftOcclusionDarkness:
    'Directional only: what a shaft occlusion of 0 maps to; 1 darkens nothing.',
  shaftOcclusionDepthRange:
    'Directional only: everything closer to the eye than this distance, in metres, occludes the shafts.',
  shaftOverrideDirection:
    "Directional only: a direction [x, y, z] the shafts come from instead of the light's own; zero, the default, keeps the light's.",
  shaftBloom: 'Whether this light adds a bloom around itself (light shafts).',
  shaftBloomScale: 'The factor on the colour the shaft bloom adds.',
  shaftBloomThreshold: 'The brightness the image must pass, after exposure, to bloom.',
  shaftBloomMaxBrightness: 'A brightness above it, after exposure, is brought down to it.',
  shaftBloomTint:
    "A linear RGB colour [R, G, B] the shaft bloom's colour is multiplied by; white by default.",
}

/** The light tool's parameter of each light shaft setting, from its rule: its kind, default,
 *  bounds and what it means. */
export const lightShaftProperties = () =>
  ruleProperties(LIGHT_SHAFT_LIGHT_RULES, LIGHT_SHAFT_MEANINGS)
