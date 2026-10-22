import { EngineError } from '../../contracts/cache.ts'
import { ATMOSPHERE_SUN_INDICES, type AtmosphereSunIndex, type SceneLight } from './contracts.ts'
import { finite } from '../core/fog.ts'
import { validateFogFields } from './validateFog.ts'
import { validateLightFunction } from './lightFunction.ts'
import { validateLightSettings } from './validateSettings.ts'
import { isShadowDistance } from '../../contracts/shadowOptions.ts'
import { HALF_PI } from '../../../../math/src/constants.ts'
import { hypot3 } from '../../../../math/src/float/hypot.ts'
import { addScaledVector3, dotVector3 } from '../../../../math/src/vector/vector.ts'

function vector(value: unknown, field: string, id: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(finite))
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: ${field} expects three finite numbers`, {
      field,
      value,
    })
  return [value[0], value[1], value[2]]
}
/** `value` divided by its `Math.hypot` length (docs/MATHS.md "Lengths", a declared use): the
 *  validated direction feeds, in double, the shadow clipmap's own normalise and basis, and the
 *  rule's product by an inverse root differs from this quotient in the last bit on about two
 *  directions in three; one not longer than 1e-6 is refused. */
function normalized(value: [number, number, number], id: string): [number, number, number] {
  const length = hypot3(value[0], value[1], value[2])
  if (!(length > 1e-6))
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: zero-length direction`, { value })
  return [value[0] / length, value[1] / length, value[2] / length]
}
/** A light's direction: three finite numbers, returned unit. The buffer sees no other. */
function direction(value: unknown, id: string): [number, number, number] {
  return normalized(vector(value, 'direction', id), id)
}
/** Direction of a type that requires one: if missing, the light is rejected before any calculation. */
function requiredDirection(value: unknown, id: string, why: string): [number, number, number] {
  if (value === undefined) throw new EngineError('INVALID_SCENE_LIGHT', `${id}: ${why}`, {})
  return direction(value, id)
}
/** A field a light type does not use is rejected, never accepted then ignored. */
function unused(
  light: SceneLight,
  field:
    | 'position'
    | 'range'
    | 'coneAngle'
    | 'emitterRadius'
    | 'emitterLength'
    | 'emitterSoftRadius'
    | 'emitterAxis'
    | 'angularRadius'
    | 'shadowDistance'
    | 'penumbra'
    | 'right'
    | 'size'
    | 'atmosphereSun'
    | 'atmosphereSunIndex'
    | 'sunDiskTint'
    | 'shadowsAir'
    | 'transmittancePerPixel',
  why: string,
) {
  if (light[field] !== undefined)
    throw new EngineError('INVALID_SCENE_LIGHT', `${light.id}: ${field} ${why}`, { field })
}
/** The fields only a spot has. */
const SPOT_ONLY = ['coneAngle', 'penumbra'] as const
/** Range of a point or spot: strictly positive, in metres. */
function range(value: unknown, id: string): number {
  if (!finite(value) || value <= 0)
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: range must be > 0`, { range: value })
  return value
}
/**
 * Radius of the envelope that holds the source, in metres: strictly positive and strictly
 * less than the range. An envelope as wide as the range would let no shadow out,
 * and the map near plane would meet its far plane: the contract rejects it instead of
 * returning a degenerate map.
 */
function emitterRadius(value: unknown, range: number, id: string): number {
  if (!finite(value) || value <= 0 || value >= range)
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: emitter radius expected in (0, range)`, {
      emitterRadius: value,
      range,
    })
  return value
}
/** A point or spot's tube and soft radius: each strictly positive, the soft radius below the range
 *  as the envelope's is; the axis, a unit direction, belongs to a tube alone. */
function validateSource(light: SceneLight, validated: SceneLight, range: number) {
  const { id } = light
  const bad = (what: string, field: string, value: unknown) =>
    new EngineError('INVALID_SCENE_LIGHT', `${id}: ${what}`, { [field]: value, range })
  if (light.emitterSoftRadius !== undefined) {
    const soft = light.emitterSoftRadius
    if (!finite(soft) || soft <= 0 || soft >= range)
      throw bad('emitter soft radius expected in (0, range)', 'emitterSoftRadius', soft)
    validated.emitterSoftRadius = soft
  }
  if (light.emitterLength === undefined)
    return unused(light, 'emitterAxis', 'exists only with an emitterLength')
  if (!finite(light.emitterLength) || light.emitterLength <= 0)
    throw bad('emitter length must be > 0', 'emitterLength', light.emitterLength)
  validated.emitterLength = light.emitterLength
  if (light.emitterAxis !== undefined) validated.emitterAxis = direction(light.emitterAxis, id)
}
/** Half-angle of a spot cone, in radians, strictly in `(0, π/2)`. */
function coneAngle(value: unknown, id: string): number {
  if (!finite(value) || value <= 0 || value >= HALF_PI)
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: cone half-angle expected in (0, π/2)`, {
      coneAngle: value,
    })
  return value
}
/** The index of the air's light a directional light is a candidate for: 0 or 1, no other — the air
 *  holds two. */
export function validateAtmosphereSunIndex(value: unknown, who: string): AtmosphereSunIndex {
  if (!ATMOSPHERE_SUN_INDICES.includes(value as AtmosphereSunIndex))
    throw new EngineError('INVALID_SCENE_LIGHT', `${who}: atmosphereSunIndex expects 0 or 1`, {
      atmosphereSunIndex: value,
    })
  return value as AtmosphereSunIndex
}
/** A switch of a light: a boolean when given. */
function validateSwitch(
  light: SceneLight,
  validated: SceneLight,
  field: 'useTemperature' | 'shadowsAir' | 'transmittancePerPixel',
) {
  const value = light[field]
  if (value === undefined) return
  if (typeof value !== 'boolean')
    throw new EngineError('INVALID_SCENE_LIGHT', `${light.id}: ${field} expects a boolean`, {
      [field]: value,
    })
  validated[field] = value
}
/** The temperature of a light: whether its colour follows it, and the kelvin (a finite number,
 *  read between 1000 and 15000 where the colour is made). */
function validateTemperature(light: SceneLight, validated: SceneLight) {
  validateSwitch(light, validated, 'useTemperature')
  if (light.temperatureKelvin === undefined) return
  if (!finite(light.temperatureKelvin))
    throw new EngineError(
      'INVALID_SCENE_LIGHT',
      `${light.id}: temperatureKelvin expects a number`,
      {
        temperatureKelvin: light.temperatureKelvin,
      },
    )
  validated.temperatureKelvin = light.temperatureKelvin
}
/** What a directional light says of the air besides its disk: the disk's tint, three numbers of at
 *  least 0, whether its shadow shades the air, and whether its transmittance is read per point. */
function validateAirSettings(light: SceneLight, validated: SceneLight) {
  validateSwitch(light, validated, 'shadowsAir')
  validateSwitch(light, validated, 'transmittancePerPixel')
  if (light.sunDiskTint === undefined) return
  const tint = vector(light.sunDiskTint, 'sunDiskTint', light.id)
  if (tint.some((channel) => channel < 0))
    throw new EngineError('INVALID_SCENE_LIGHT', `${light.id}: negative sunDiskTint`, { tint })
  validated.sunDiskTint = tint
}
/**
 * The fields of a directional light: whether it is the atmosphere's sun and which, its angular
 * radius, and its direction, required. It has neither position nor range, and says so by refusing them.
 */
function validateDirectional(light: SceneLight, validated: SceneLight): SceneLight {
  const { id } = light
  if (light.atmosphereSun !== undefined) {
    if (typeof light.atmosphereSun !== 'boolean')
      throw new EngineError('INVALID_SCENE_LIGHT', `${id}: atmosphereSun expects a boolean`, {
        atmosphereSun: light.atmosphereSun,
      })
    validated.atmosphereSun = light.atmosphereSun
  }
  if (light.atmosphereSunIndex !== undefined)
    validated.atmosphereSunIndex = validateAtmosphereSunIndex(light.atmosphereSunIndex, id)
  validateAirSettings(light, validated)
  if (light.angularRadius !== undefined) {
    if (!finite(light.angularRadius) || light.angularRadius < 0 || light.angularRadius >= HALF_PI)
      throw new EngineError('INVALID_SCENE_LIGHT', `${id}: invalid angularRadius`, {
        angularRadius: light.angularRadius,
      })
    validated.angularRadius = light.angularRadius
  }
  if (light.shadowDistance !== undefined) {
    if (!isShadowDistance(light.shadowDistance))
      throw new EngineError(
        'INVALID_SCENE_LIGHT',
        `${id}: shadowDistance expects a finite number of metres of at least 0`,
        { shadowDistance: light.shadowDistance },
      )
    validated.shadowDistance = light.shadowDistance
  }
  unused(light, 'position', 'does not exist for a directional light')
  unused(light, 'range', 'does not exist for a directional light: it carries everywhere')
  for (const field of SPOT_ONLY) unused(light, field, 'exists only for a spot')
  unused(light, 'emitterRadius', 'does not exist for a directional light: it has no position')
  for (const field of ['emitterLength', 'emitterSoftRadius', 'emitterAxis'] as const)
    unused(light, field, 'does not exist for a directional light: it has no position')
  validated.direction = requiredDirection(
    light.direction,
    id,
    'a directional requires its direction',
  )
  return validated
}
/** The fields only a directional light has (besides its angular radius and shadow distance). */
const DIRECTIONAL_ONLY = [
  'atmosphereSun',
  'atmosphereSunIndex',
  'sunDiskTint',
  'shadowsAir',
  'transmittancePerPixel',
] as const
/**
 * Validates a light and returns a normalised copy. A rejected light never enters the buffer:
 * the contract accepts neither negative intensity, nor zero range, nor a spot without direction, nor
 * a directional light that would claim a position or a range.
 */
export function validateSceneLight(light: SceneLight): SceneLight {
  const id = light?.id
  if (typeof id !== 'string' || !id.length)
    throw new EngineError('INVALID_SCENE_LIGHT', 'empty light identifier', { id })
  if (!['point', 'spot', 'directional', 'rect'].includes(light.kind))
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: unknown type ${String(light.kind)}`, {
      kind: light.kind,
    })
  if (!finite(light.intensity) || light.intensity <= 0)
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: intensity must be > 0`, {
      intensity: light.intensity,
    })
  const color = vector(light.color, 'color', id)
  if (color.some((channel) => channel < 0))
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: negative colour`, { color })
  const validated: SceneLight = {
    id,
    kind: light.kind,
    color,
    intensity: light.intensity,
    castsShadow: !!light.castsShadow,
  }
  validateTemperature(light, validated)
  validateFogFields(light, validated)
  validateLightFunction(light, validated)
  validateLightSettings(light, validated)
  if (light.kind !== 'rect')
    for (const field of ['right', 'size'] as const) unused(light, field, 'exists only for a rect')
  if (light.kind !== 'directional')
    for (const field of DIRECTIONAL_ONLY)
      unused(light, field, 'exists only for a directional light')
  if (light.kind === 'directional') return validateDirectional(light, validated)
  unused(light, 'angularRadius', 'exists only for a directional light')
  unused(light, 'shadowDistance', 'exists only for a directional light')
  validated.position = vector(light.position, 'position', id)
  validated.range = range(light.range, id)
  if (light.emitterRadius !== undefined)
    validated.emitterRadius = emitterRadius(light.emitterRadius, validated.range, id)
  if (light.kind === 'rect') return validateRect(light, validated)
  validateSource(light, validated, validated.range)
  if (light.kind === 'spot') {
    validated.direction = requiredDirection(light.direction, id, 'a spot requires a direction')
    validated.coneAngle = coneAngle(light.coneAngle, id)
    if (light.penumbra !== undefined) {
      if (!finite(light.penumbra) || light.penumbra < 0 || light.penumbra > 1)
        throw new EngineError('INVALID_SCENE_LIGHT', `${id}: penumbra expected in [0, 1]`, {
          penumbra: light.penumbra,
        })
      validated.penumbra = light.penumbra
    }
    return validated
  }
  for (const field of SPOT_ONLY) unused(light, field, 'exists only for a spot')
  if (light.direction !== undefined) validated.direction = direction(light.direction, id)
  return validated
}
/**
 * The fields of a rectangle: the normal of its emitting face, its width axis — made
 * perpendicular to that normal, then unit —, and its two sides, strictly positive. It casts no
 * shadow, and says so by refusing one: a flag the engine would not honour is not accepted.
 */
function validateRect(light: SceneLight, validated: SceneLight): SceneLight {
  const { id } = light
  for (const field of SPOT_ONLY) unused(light, field, 'exists only for a spot')
  unused(light, 'emitterRadius', 'bounds a shadow map, which a rect does not have')
  for (const field of ['emitterLength', 'emitterSoftRadius', 'emitterAxis'] as const)
    unused(light, field, 'exists only for a point or a spot')
  if (light.castsShadow)
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: a rect casts no shadow`, {})
  const normal = requiredDirection(light.direction, id, 'a rect requires the normal of its face')
  const right = vector(light.right, 'right', id)
  addScaledVector3(right, normal, -dotVector3(right, normal))
  validated.direction = normal
  validated.right = normalized(right, id)
  const size = light.size
  if (!Array.isArray(size) || size.length !== 2 || !size.every((side) => finite(side) && side > 0))
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: size expects two sides > 0`, { size })
  validated.size = [size[0], size[1]]
  return validated
}
