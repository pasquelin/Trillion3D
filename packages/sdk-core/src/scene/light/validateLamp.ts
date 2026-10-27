import { EngineError } from '../../contracts/cache.ts'
import { isFiniteNumber } from '../../../../math/src/scalar/reals.ts'
import type { SceneLight } from './contracts.ts'
import { direction, unused } from './validateBasics.ts'

/** The fields of the source of a point or a spot: a rectangle's is its `size`. */
const SOURCE = ['emitterRadius', 'emitterLength', 'emitterSoftRadius', 'emitterAxis'] as const
/** The fields of how a point or a spot falls off with the distance. */
const FALLOFF = ['inverseSquared', 'radialExponent'] as const
/** The fields only a point or a spot has: its source and its fall-off. */
export const LAMP_ONLY = /* @__PURE__ */ (() => [...SOURCE, ...FALLOFF] as const)()

/** The error of a field `field` of light `id` that holds `value`, the light's `range` told where it
 *  bounds the field. */
const refused = (id: string, what: string, field: string, value: unknown, range?: number) =>
  new EngineError('INVALID_SCENE_LIGHT', `${id}: ${what}`, {
    [field]: value,
    ...(range === undefined ? {} : { range }),
  })

/**
 * Radius of the source, in metres: strictly positive and strictly less than the range: the source
 * sphere lies inside the light's reach, and the contract rejects a wider one instead of lighting
 * from a source the range cuts.
 */
function emitterRadius(value: unknown, range: number, id: string): number {
  if (!isFiniteNumber(value) || value <= 0 || value >= range)
    throw refused(id, 'emitter radius expected in (0, range)', 'emitterRadius', value, range)
  return value
}

/** A point or spot's tube and soft radius: each strictly positive, the soft radius below the range
 *  as the source radius is; the axis, a unit direction, belongs to a tube or a profile alone. */
function validateSource(light: SceneLight, validated: SceneLight, range: number) {
  const { id } = light
  if (light.emitterSoftRadius !== undefined) {
    const soft = light.emitterSoftRadius
    if (!isFiniteNumber(soft) || soft <= 0 || soft >= range)
      throw refused(
        id,
        'emitter soft radius expected in (0, range)',
        'emitterSoftRadius',
        soft,
        range,
      )
    validated.emitterSoftRadius = soft
  }
  if (light.emitterLength !== undefined) {
    if (!isFiniteNumber(light.emitterLength) || light.emitterLength <= 0)
      throw refused(id, 'emitter length must be > 0', 'emitterLength', light.emitterLength, range)
    validated.emitterLength = light.emitterLength
  } else if (light.iesProfile === undefined)
    return unused(light, 'emitterAxis', 'exists only with an emitterLength or an iesProfile')
  if (light.emitterAxis !== undefined) validated.emitterAxis = direction(light.emitterAxis, id)
}

/** How a point or spot falls off: whether it is the inverse square, a boolean, and the exponent it
 *  falls off by where it is not, a number above 0. */
function validateFalloff(light: SceneLight, validated: SceneLight) {
  const { id, inverseSquared, radialExponent } = light
  if (inverseSquared !== undefined) {
    if (typeof inverseSquared !== 'boolean')
      throw refused(id, 'inverseSquared expects a boolean', 'inverseSquared', inverseSquared)
    validated.inverseSquared = inverseSquared
  }
  if (radialExponent === undefined) return
  if (!isFiniteNumber(radialExponent) || radialExponent <= 0)
    throw refused(id, 'radialExponent must be > 0', 'radialExponent', radialExponent)
  validated.radialExponent = radialExponent
}

/** The fields of a point or a spot's source and fall-off into `validated`, its source radius
 *  among them; `range` is the light's validated range. */
export function validateLampFields(light: SceneLight, validated: SceneLight, range: number) {
  if (light.emitterRadius !== undefined)
    validated.emitterRadius = emitterRadius(light.emitterRadius, range, light.id)
  validateSource(light, validated, range)
  validateFalloff(light, validated)
}

/** A number of a light, `field`, into `validated` where named: finite, from 0 to `most`; `expects` says the range. */
function validateNumber(
  light: SceneLight,
  validated: SceneLight,
  field: 'diffuseShare' | 'specularShare' | LocalNumber,
  most: number,
  expects: string,
) {
  const value = light[field]
  if (value === undefined) return
  if (!isFiniteNumber(value) || value < 0 || value > most)
    throw refused(light.id, `${field} expected ${expects}`, field, value)
  validated[field] = value
}

/** The numbers only a point, a spot or a rect has, each 0 by default: the blend of the light's strength with the inverse
 *  of the exposure (`SceneLight.inverseExposureBlend`), and the distance past which the light is left out
 *  (`SceneLight.maxDrawDistance`). The one list of them: the light's validation, the world light's numbers and its record read it. */
export const LOCAL_NUMBERS = ['inverseExposureBlend', 'maxDrawDistance'] as const
type LocalNumber = (typeof LOCAL_NUMBERS)[number]

/** The most each of the `LOCAL_NUMBERS` takes, and what it expects. */
const LOCAL_LIMITS: Record<LocalNumber, readonly [most: number, expects: string]> = {
  inverseExposureBlend: [1, 'in [0, 1]'],
  maxDrawDistance: [Infinity, '>= 0'],
}

/** The numbers of a point, a spot or a rect (`LOCAL_NUMBERS`) into `validated` where named; a directional light has none. */
export function validateLocalNumbers(light: SceneLight, validated: SceneLight) {
  for (const field of LOCAL_NUMBERS) {
    if (light.kind === 'directional')
      unused(light, field, 'exists only for a point, a spot or a rect')
    validateNumber(light, validated, field, ...LOCAL_LIMITS[field])
  }
}

/** The shares of its diffuse and its specular light a light gives, each a number from 0 to 1, into
 *  `validated` where named: any kind of light has them. */
export function validateShares(light: SceneLight, validated: SceneLight) {
  validateNumber(light, validated, 'diffuseShare', 1, 'in [0, 1]')
  validateNumber(light, validated, 'specularShare', 1, 'in [0, 1]')
}
