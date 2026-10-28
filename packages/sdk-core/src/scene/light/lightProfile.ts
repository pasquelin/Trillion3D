import { isFiniteNumber } from '../../../../math/src/scalar/reals.ts'
import { hypot3 } from '../../../../math/src/float/hypot.ts'
import { addScaledVector3, dotVector3 } from '../../../../math/src/vector/vector.ts'
import type { SceneLight } from './contracts.ts'
import { bad } from './lightFunction.ts'
import { unused } from './validateBasics.ts'
import { useIesBrightnessOf, iesBrightnessScaleOf } from './iesBrightness.ts'

/** The fields a light has only beside an `iesProfile`. */
const BESIDE_PROFILE = ['useIesBrightness', 'iesBrightnessScale', 'iesBrightness'] as const
/** Every field of a light's profile: refused on a sun and on a rect. */
const LIGHT_PROFILE_FIELDS = [
  'iesProfile',
  'useIesBrightness',
  'iesBrightnessScale',
  'iesBrightness',
] as const

/**
 * The intensity of a light in its own unit once its profile is counted: the `declared` one, or,
 * for a light whose `useIesBrightness` is on and that carries its profile's brightness in candelas
 * (`iesBrightness`), the brightness times the light's scale. In EV the brightness is a luminance and the intensity its
 * logarithm to the base 2, so that the unit's conversion gives the brightness back (a profile is
 * read in candelas, whatever the unit the intensity is written in). A brightness of 0 (a scale of 0) is, in EV, the logarithm of the least
 * positive number, not minus infinity as the reference's conversion gives (`LuminanceToEV100` of 0), which the unit's conversion and
 * the products after it would turn into a NaN: the light is as dark, to the precision of a float.
 */
export function profiledIntensityOf(
  light: Pick<
    SceneLight,
    'iesProfile' | 'useIesBrightness' | 'iesBrightnessScale' | 'iesBrightness' | 'intensityUnits'
  >,
  declared: number,
) {
  const { iesProfile, iesBrightness } = light
  if (iesProfile === undefined || !useIesBrightnessOf(light) || iesBrightness === undefined)
    return declared
  const candelas = iesBrightness * iesBrightnessScaleOf(light)
  return light.intensityUnits === 'ev' ? Math.log2(Math.max(candelas, Number.MIN_VALUE)) : candelas
}

/** A sun and a rect have no profile: their fields are refused, never accepted then ignored. */
export function refuseLightProfile(light: SceneLight) {
  for (const field of LIGHT_PROFILE_FIELDS)
    unused(light, field, 'exists only for a point or a spot')
}

/**
 * The profile fields of a point or a spot, into `validated` once its `direction` and `emitterAxis`
 * are: a profile id, and, only beside it, the brightness switch, the scale of at least 0 and the profile's own brightness (finite,
 * above 0, the compiler's). A
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
  const { useIesBrightness: use, iesBrightnessScale: scale, iesBrightness: brightness } = light
  if (use !== undefined) {
    if (typeof use !== 'boolean') throw bad(id, 'useIesBrightness expects a boolean', use)
    validated.useIesBrightness = use
  }
  if (scale !== undefined) {
    if (!isFiniteNumber(scale) || scale < 0) throw bad(id, 'iesBrightnessScale must be >= 0', scale)
    validated.iesBrightnessScale = scale
  }
  if (brightness !== undefined) {
    if (!isFiniteNumber(brightness) || brightness <= 0)
      throw bad(id, 'iesBrightness must be a finite number above 0', brightness)
    validated.iesBrightness = brightness
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

/** Two lights with the same profile: the same id, brightness switch, scale and brightness. */
export const sameLightProfile = (a: SceneLight, b: SceneLight) =>
  a.iesProfile === b.iesProfile &&
  useIesBrightnessOf(a) === useIesBrightnessOf(b) &&
  iesBrightnessScaleOf(a) === iesBrightnessScaleOf(b) &&
  a.iesBrightness === b.iesBrightness

/** The value of a light's profile lane in its kind word for atlas slice `slice` (−1 for none): the
 *  slice plus one, 0 for none, so that a word never written reads as none. */
export const profileLaneOf = (slice: number) => slice + 1
/** The atlas slice a profile lane names; −1 for none. */
export const profileSliceOf = (lane: number) => lane - 1
