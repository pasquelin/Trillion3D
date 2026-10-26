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
 * Radius of the envelope that holds the source, in metres: strictly positive and strictly
 * less than the range. An envelope as wide as the range would let no shadow out,
 * and the map near plane would meet its far plane: the contract rejects it instead of
 * returning a degenerate map.
 */
function emitterRadius(value: unknown, range: number, id: string): number {
  if (!isFiniteNumber(value) || value <= 0 || value >= range)
    throw refused(id, 'emitter radius expected in (0, range)', 'emitterRadius', value, range)
  return value
}

/** A point or spot's tube and soft radius: each strictly positive, the soft radius below the range
 *  as the envelope's is; the axis, a unit direction, belongs to a tube alone. */
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
  if (light.emitterLength === undefined)
    return unused(light, 'emitterAxis', 'exists only with an emitterLength')
  if (!isFiniteNumber(light.emitterLength) || light.emitterLength <= 0)
    throw refused(id, 'emitter length must be > 0', 'emitterLength', light.emitterLength, range)
  validated.emitterLength = light.emitterLength
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

/** The fields of a point or a spot's source and fall-off into `validated`, its envelope's radius
 *  among them; `range` is the light's validated range. */
export function validateLampFields(light: SceneLight, validated: SceneLight, range: number) {
  if (light.emitterRadius !== undefined)
    validated.emitterRadius = emitterRadius(light.emitterRadius, range, light.id)
  validateSource(light, validated, range)
  validateFalloff(light, validated)
}

/** The shares of its diffuse and its specular light a light gives, each a number from 0 to 1, into
 *  `validated` where named: any kind of light has them. */
export function validateShares(light: SceneLight, validated: SceneLight) {
  for (const field of ['diffuseShare', 'specularShare'] as const) {
    const share = light[field]
    if (share === undefined) continue
    if (!isFiniteNumber(share) || share < 0 || share > 1)
      throw refused(light.id, `${field} expected in [0, 1]`, field, share)
    validated[field] = share
  }
}
