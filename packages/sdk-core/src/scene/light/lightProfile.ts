import { EngineError } from '../../contracts/cache.ts'
import { isFiniteNumber } from '../../../../math/src/scalar/reals.ts'
import { hypot3 } from '../../../../math/src/float/hypot.ts'
import { addScaledVector3, dotVector3 } from '../../../../math/src/vector/vector.ts'
import type { SceneLight } from './contracts.ts'
import { unused } from './validateBasics.ts'

/** The defaults of a light's profile: its intensity kept, and the profile's brightness, when it is
 *  used, times 1. */
export const LIGHT_PROFILE_DEFAULTS = { useBrightness: false, brightnessScale: 1 } as const

/** The fields a light has only beside an `iesProfile`. */
const BESIDE_PROFILE = ['useIesBrightness', 'iesBrightnessScale'] as const
/** Every field of a light's profile: refused on a sun and on a rect. */
export const LIGHT_PROFILE_FIELDS = ['iesProfile', ...BESIDE_PROFILE] as const

/** Whether a light's intensity is its profile's brightness: off when it names nothing. */
export const useIesBrightnessOf = (light: Pick<SceneLight, 'useIesBrightness'>) =>
  light.useIesBrightness ?? LIGHT_PROFILE_DEFAULTS.useBrightness

/** The factor on a profile's brightness: 1 when the light names none. */
export const iesBrightnessScaleOf = (light: Pick<SceneLight, 'iesBrightnessScale'>) =>
  light.iesBrightnessScale ?? LIGHT_PROFILE_DEFAULTS.brightnessScale

/** The brightness, in candelas, of the profiles the lights name, as the browser has loaded them
 *  (`createLightProfileBrightness`). */
export interface LightProfileView {
  brightnessOf(profile: string): number | undefined
}

/** The view of a store that holds no profile. */
export const NO_LIGHT_PROFILES: LightProfileView = { brightnessOf: () => undefined }

/** The profiles' brightnesses a store holds: set as a profile loads. */
export function createLightProfileBrightness() {
  const held = new Map<string, number>()
  return {
    brightnessOf: (profile: string) => held.get(profile),
    /** Records the brightness of `profile`; returns whether that changed what was known. */
    set(profile: string, brightness: number) {
      if (held.get(profile) === brightness) return false
      held.set(profile, brightness)
      return true
    },
  }
}

/** The brightness, in candelas, of the profile a light names, as `view` knows it: none for a light that
 *  names no profile or one not loaded. */
export const profileBrightnessOf = (
  light: Pick<SceneLight, 'iesProfile'>,
  view: LightProfileView,
) => (light.iesProfile === undefined ? undefined : view.brightnessOf(light.iesProfile))

/**
 * The intensity of a light in its own unit once its profile is counted: the `declared` one, or,
 * for a light whose `useIesBrightness` is on and whose profile's `brightness` in candelas is known,
 * the brightness times the light's scale. In EV the brightness is a luminance and the intensity its
 * logarithm to the base 2, so that the unit's conversion gives the brightness back (a profile is
 * read in candelas, whatever the unit the intensity is written in). A brightness of 0 (a scale of 0) is, in EV, the logarithm of the least
 * positive number, not minus infinity as the reference's conversion gives (`LuminanceToEV100` of 0), which the unit's conversion and
 * the products after it would turn into a NaN: the light is as dark, to the precision of a float.
 */
export function profiledIntensityOf(
  light: Pick<
    SceneLight,
    'iesProfile' | 'useIesBrightness' | 'iesBrightnessScale' | 'intensityUnits'
  >,
  declared: number,
  brightness: number | undefined,
) {
  if (light.iesProfile === undefined || !useIesBrightnessOf(light) || brightness === undefined)
    return declared
  const candelas = brightness * iesBrightnessScaleOf(light)
  return light.intensityUnits === 'ev' ? Math.log2(Math.max(candelas, Number.MIN_VALUE)) : candelas
}

const bad = (id: string, what: string, value: unknown) =>
  new EngineError('INVALID_SCENE_LIGHT', `${id}: ${what}`, { value })

/** A sun and a rect have no profile: their fields are refused, never accepted then ignored. */
export function refuseLightProfile(light: SceneLight) {
  for (const field of LIGHT_PROFILE_FIELDS)
    unused(light, field, 'exists only for a point or a spot')
}

/**
 * The profile fields of a point or a spot, into `validated` once its `direction` and `emitterAxis`
 * are: a profile id, and, only beside it, the brightness switch and the scale of at least 0. A
 * profile needs the light's direction and its axis, which may not be parallel to it.
 */
export function validateLightProfile(light: SceneLight, validated: SceneLight) {
  const { id, iesProfile } = light
  if (iesProfile === undefined) {
    for (const field of BESIDE_PROFILE) unused(light, field, 'exists only beside an iesProfile')
    return
  }
  if (typeof iesProfile !== 'string' || !iesProfile)
    throw bad(id, 'iesProfile expects a profile id', iesProfile)
  validated.iesProfile = iesProfile
  const { useIesBrightness: use, iesBrightnessScale: scale } = light
  if (use !== undefined) {
    if (typeof use !== 'boolean') throw bad(id, 'useIesBrightness expects a boolean', use)
    validated.useIesBrightness = use
  }
  if (scale !== undefined) {
    if (!isFiniteNumber(scale) || scale < 0) throw bad(id, 'iesBrightnessScale must be >= 0', scale)
    validated.iesBrightnessScale = scale
  }
  const { direction, emitterAxis } = validated
  if (direction === undefined)
    throw bad(id, 'an iesProfile requires the light direction', direction)
  if (emitterAxis === undefined)
    throw bad(
      id,
      'an iesProfile requires an emitterAxis, the axis its horizontal angle runs round',
      emitterAxis,
    )
  const across: [number, number, number] = [...emitterAxis]
  addScaledVector3(across, direction, -dotVector3(across, direction))
  if (!(hypot3(across[0], across[1], across[2]) > 1e-6))
    throw bad(id, 'emitterAxis must not be parallel to the direction', emitterAxis)
}

/** Two lights with the same profile: the same id, brightness switch and scale. */
export const sameLightProfile = (a: SceneLight, b: SceneLight) =>
  a.iesProfile === b.iesProfile &&
  useIesBrightnessOf(a) === useIesBrightnessOf(b) &&
  iesBrightnessScaleOf(a) === iesBrightnessScaleOf(b)

/** The value of a light's profile lane in its kind word for atlas slice `slice` (−1 for none): the
 *  slice plus one, 0 for none, so that a word never written reads as none. */
export const profileLaneOf = (slice: number) => slice + 1
/** The atlas slice a profile lane names; −1 for none. */
export const profileSliceOf = (lane: number) => lane - 1
