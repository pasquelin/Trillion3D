import { EngineError } from '../../contracts/cache.ts'
import {
  ATMOSPHERE_SUN_INDICES,
  LIGHT_KIND,
  type AtmosphereSunIndex,
  type SceneLight,
} from './contracts.ts'
import { isFiniteNumber } from '../../../../math/src/scalar/reals.ts'
import {
  internLightingChannels,
  lightingChannelsRefusal,
} from '../../contracts/lightingChannelsAbi.ts'
import { normalized, requiredDirection, unused, vector, direction } from './validateBasics.ts'
import { LAMP_ONLY, validateLampFields } from './validateLamp.ts'
import { validateFogFields, validateMobility } from './validateFog.ts'
import { validateLightFunction } from './lightFunction.ts'
import { validateLightSettings } from './validateSettings.ts'
import { validateLightShadow } from './lightShadow.ts'
import { refuseLightProfile, validateLightProfile } from './lightProfile.ts'
import { refuseSourceTexture, validateSourceTexture } from './lightSourceTexture.ts'
import { LIGHT_UNITS } from './lightUnits.ts'
import { readsUnits, sourceAreaOf } from './fields.ts'
import { HALF_PI } from '../../../../math/src/constants.ts'
import { addScaledVector3, dotVector3 } from '../../../../math/src/vector/vector.ts'

/** The fields only a spot has. */
const SPOT_ONLY = ['innerConeAngle', 'outerConeAngle'] as const
/** Range of a point or spot: strictly positive, in metres. */
function range(value: unknown, id: string): number {
  if (!isFiniteNumber(value) || value <= 0)
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: range must be > 0`, { range: value })
  return value
}
/** Outer half-angle of a spot cone, in radians, strictly in `(0, π/2)`. */
function outerConeAngle(value: unknown, id: string): number {
  if (!isFiniteNumber(value) || value <= 0 || value >= HALF_PI)
    throw new EngineError(
      'INVALID_SCENE_LIGHT',
      `${id}: outer cone half-angle expected in (0, π/2)`,
      { outerConeAngle: value },
    )
  return value
}
/** Inner half-angle of a spot cone, in radians, in `[0, π/2)`. */
function innerConeAngle(value: unknown, id: string): number {
  if (!isFiniteNumber(value) || value < 0 || value >= HALF_PI)
    throw new EngineError(
      'INVALID_SCENE_LIGHT',
      `${id}: inner cone half-angle expected in [0, π/2)`,
      { innerConeAngle: value },
    )
  return value
}
/** A light's intensity and its unit into `validated` where named: a unit of `LIGHT_UNITS` on a
 *  point, spot or rect alone; an intensity finite, and at least 0 but in `'ev'` where the
 *  unit is read (`readsUnits`: off the inverse square the number is a brightness, at least 0 in any
 *  unit). A lamp in nits whose unit is read needs a source of some area: a point or spot without
 *  an `emitterRadius` would give no light. */
function validateIntensity(light: SceneLight, validated: SceneLight) {
  const { id, intensity, intensityUnits: units } = light
  if (units !== undefined) {
    if (light.kind === 'directional') unused(light, 'intensityUnits', 'exists only for a lamp')
    if (!LIGHT_UNITS.includes(units))
      throw new EngineError('INVALID_SCENE_LIGHT', `${id}: unknown intensityUnits`, { units })
    if (
      units === 'nits' &&
      light.kind !== 'rect' &&
      readsUnits(light) &&
      !(sourceAreaOf(light) > 0)
    )
      throw new EngineError('INVALID_SCENE_LIGHT', `${id}: a lamp in nits needs an emitterRadius`, {
        units,
      })
    validated.intensityUnits = units
  }
  if (intensity === undefined) return
  const anyNumber = units === 'ev' && readsUnits(light)
  if (!isFiniteNumber(intensity) || (!anyNumber && intensity < 0))
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: intensity must be >= 0`, { intensity })
  validated.intensity = intensity
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
  field:
    | 'useTemperature'
    | 'shadowsAir'
    | 'transmittancePerPixel'
    | 'transmission'
    | 'castHairDeepShadow'
    | 'castTranslucentShadows',
) {
  const value = light[field]
  if (value === undefined) return
  if (typeof value !== 'boolean')
    throw new EngineError('INVALID_SCENE_LIGHT', `${light.id}: ${field} expects a boolean`, {
      [field]: value,
    })
  validated[field] = value
}
/** `hairDeepShadowLayerDistribution`, copied onto `validated` when given: a number from 0 to 1. */
function validateHairDeepShadowLayerDistribution(light: SceneLight, validated: SceneLight) {
  const value = light.hairDeepShadowLayerDistribution
  if (value === undefined) return
  if (!isFiniteNumber(value) || value < 0 || value > 1)
    throw new EngineError(
      'INVALID_SCENE_LIGHT',
      `${light.id}: hairDeepShadowLayerDistribution expected in [0, 1]`,
      { hairDeepShadowLayerDistribution: value },
    )
  validated.hairDeepShadowLayerDistribution = value
}
/** The classic cascades' four fields of a sun, copied onto `validated` when given: a count of cascades (an integer from 0), the exponent (1 or more), the transition fraction (0 to 1), the distance in metres (0 or more). */
function validateCascadeFields(light: SceneLight, validated: SceneLight) {
  const fields = [
    ['dynamicShadowCascades', 0, 1e6, true],
    ['cascadeDistributionExponent', 1, 1e6, false],
    ['cascadeTransitionFraction', 0, 1, false],
    ['dynamicShadowDistance', 0, 1e9, false],
    ['shadowBias', 0, 4, false],
    ['shadowSlopeBias', 0, 4, false],
  ] as const
  for (const [field, low, high, whole] of fields) {
    const value = light[field]
    if (value === undefined) continue
    if (
      !isFiniteNumber(value) ||
      value < low ||
      value > high ||
      (whole && !Number.isInteger(value))
    )
      throw new EngineError(
        'INVALID_SCENE_LIGHT',
        `${light.id}: ${field} expected ${whole ? 'an integer ' : ''}in [${low}, ${high}]`,
        { [field]: value },
      )
    validated[field] = value
  }
}
/** `lightingChannels`, copied onto `validated` when given: a set of the three channels. */
function validateLightingChannels(light: SceneLight, validated: SceneLight) {
  const { id, lightingChannels } = light
  if (lightingChannels === undefined) return
  const problem = lightingChannelsRefusal('lightingChannels', lightingChannels)
  if (problem)
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: ${problem}`, { lightingChannels })
  validated.lightingChannels = internLightingChannels(lightingChannels)
}
/** The temperature of a light: whether its colour follows it, and the kelvin (a finite number,
 *  read between 1000 and 15000 where the colour is made). */
function validateTemperature(light: SceneLight, validated: SceneLight) {
  validateSwitch(light, validated, 'useTemperature')
  if (light.temperatureKelvin === undefined) return
  if (!isFiniteNumber(light.temperatureKelvin))
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
    if (
      !isFiniteNumber(light.angularRadius) ||
      light.angularRadius < 0 ||
      light.angularRadius >= HALF_PI
    )
      throw new EngineError('INVALID_SCENE_LIGHT', `${id}: invalid angularRadius`, {
        angularRadius: light.angularRadius,
      })
    validated.angularRadius = light.angularRadius
  }
  if (light.softAngle !== undefined) {
    if (!isFiniteNumber(light.softAngle) || light.softAngle < 0 || light.softAngle >= 180)
      throw new EngineError('INVALID_SCENE_LIGHT', `${id}: softAngle expected in [0, 180)`, {
        softAngle: light.softAngle,
      })
    validated.softAngle = light.softAngle
  }
  unused(light, 'position', 'does not exist for a directional light')
  unused(light, 'range', 'does not exist for a directional light: it carries everywhere')
  for (const field of SPOT_ONLY) unused(light, field, 'exists only for a spot')
  for (const field of LAMP_ONLY)
    unused(light, field, 'does not exist for a directional light: it has no position')
  refuseLightProfile(light)
  refuseSourceTexture(light)
  validated.direction = requiredDirection(
    light.direction,
    id,
    'a directional requires its direction',
  )
  return validated
}
/** The fields only a directional light has (besides its angular radius and its shadows, `lightShadow.ts`). */
const DIRECTIONAL_ONLY = [
  'softAngle',
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
  if (!Object.hasOwn(LIGHT_KIND, light.kind))
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: unknown type ${String(light.kind)}`, {
      kind: light.kind,
    })
  const color = vector(light.color, 'color', id)
  if (color.some((channel) => channel < 0))
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: negative colour`, { color })
  const validated: SceneLight = { id, kind: light.kind, color, castsShadow: !!light.castsShadow }
  validateIntensity(light, validated)
  validateTemperature(light, validated)
  validateSwitch(light, validated, 'transmission')
  validateSwitch(light, validated, 'castHairDeepShadow')
  validateSwitch(light, validated, 'castTranslucentShadows')
  validateHairDeepShadowLayerDistribution(light, validated)
  validateCascadeFields(light, validated)
  validateLightingChannels(light, validated)
  validateFogFields(light, validated)
  validateMobility(light, validated)
  validateLightFunction(light, validated)
  validateLightSettings(light, validated)
  validateLightShadow(light, validated)
  if (light.kind !== 'rect')
    for (const field of ['right', 'size'] as const) unused(light, field, 'exists only for a rect')
  if (light.kind !== 'directional')
    for (const field of DIRECTIONAL_ONLY)
      unused(light, field, 'exists only for a directional light')
  if (light.kind === 'directional') return validateDirectional(light, validated)
  unused(light, 'angularRadius', 'exists only for a directional light')
  validated.position = vector(light.position, 'position', id)
  validated.range = range(light.range, id)
  if (light.kind === 'rect') return validateRect(light, validated)
  validateLampFields(light, validated, validated.range)
  if (light.kind === 'spot') {
    validated.direction = requiredDirection(light.direction, id, 'a spot requires a direction')
    validated.outerConeAngle = outerConeAngle(light.outerConeAngle, id)
    refuseSourceTexture(light)
    if (light.innerConeAngle !== undefined)
      validated.innerConeAngle = innerConeAngle(light.innerConeAngle, id)
    validateLightProfile(light, validated)
    return validated
  }
  for (const field of SPOT_ONLY) unused(light, field, 'exists only for a spot')
  refuseSourceTexture(light)
  if (light.direction !== undefined) validated.direction = direction(light.direction, id)
  validateLightProfile(light, validated)
  return validated
}
/**
 * The fields of a rectangle: the normal of its emitting face, its width axis — made
 * perpendicular to that normal, then unit —, and its two sides, strictly positive. It casts a shadow
 * as a point light does, its source radius half its width (`projectionLight`): it takes no
 * `emitterRadius`, the radius of a point or a spot's source, which a rectangle has none of.
 */
function validateRect(light: SceneLight, validated: SceneLight): SceneLight {
  const { id } = light
  for (const field of SPOT_ONLY) unused(light, field, 'exists only for a spot')
  for (const field of LAMP_ONLY) unused(light, field, 'exists only for a point or a spot')
  refuseLightProfile(light)
  const normal = requiredDirection(light.direction, id, 'a rect requires the normal of its face')
  const right = vector(light.right, 'right', id)
  addScaledVector3(right, normal, -dotVector3(right, normal))
  validated.direction = normal
  validated.right = normalized(right, id)
  const size = light.size
  if (
    !Array.isArray(size) ||
    size.length !== 2 ||
    !size.every((side) => isFiniteNumber(side) && side > 0)
  )
    throw new EngineError('INVALID_SCENE_LIGHT', `${id}: size expects two sides > 0`, { size })
  validated.size = [size[0], size[1]]
  validateSourceTexture(light, validated)
  return validated
}
