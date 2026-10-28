import type { SceneLight } from './contracts.ts'

/** The defaults of a light's profile: its intensity kept, and the profile's brightness, when it is
 *  used, times 1. */
const LIGHT_PROFILE_DEFAULTS = { useBrightness: false, brightnessScale: 1 } as const

/** Whether a light's intensity is its profile's brightness: off when it names nothing. */
export const useIesBrightnessOf = (light: Pick<SceneLight, 'useIesBrightness'>) =>
  light.useIesBrightness ?? LIGHT_PROFILE_DEFAULTS.useBrightness

/** The factor on a profile's brightness: 1 when the light names none. */
export const iesBrightnessScaleOf = (light: Pick<SceneLight, 'iesBrightnessScale'>) =>
  light.iesBrightnessScale ?? LIGHT_PROFILE_DEFAULTS.brightnessScale
