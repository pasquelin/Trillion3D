import { DEG2RAD } from '../../../../math/src/constants.ts'
import { shadowDistanceOf } from '../../contracts/shadowOptions.ts'
import { LIGHT_SETTINGS } from '../../scene/light/contracts.ts'
import { DEFAULT_TEMPERATURE_KELVIN } from '../../scene/light/fields.ts'
import type { LightParameters } from './lightParameters.ts'

/** The numbers a light carries, each a property whose write reaches the world at once. */
export const NUMBERS = [
  'intensity',
  'distance',
  'decay',
  'angle',
  'penumbra',
  'width',
  'height',
  'radius',
  'tubeLength',
  'softRadius',
  'angularRadius',
  'shadowDistance',
  'fogScattering',
  'temperatureKelvin',
] as const
export type LightNumber = (typeof NUMBERS)[number]

/** The numbers a light of `kind` starts with: the parameters' or the defaults. */
export function initialNumbers(kind: string, p: LightParameters): Record<LightNumber, number> {
  return {
    intensity: p.intensity ?? 1,
    distance: p.distance ?? 0,
    decay: p.decay ?? 2,
    angle: p.angle ?? 60 * DEG2RAD,
    penumbra: p.penumbra ?? 0,
    width: p.width ?? 10,
    height: p.height ?? 10,
    radius: p.radius ?? 0,
    tubeLength: p.tubeLength ?? 0,
    softRadius: p.softRadius ?? 0,
    angularRadius:
      p.angularRadius ?? (kind === 'directional' ? LIGHT_SETTINGS.sunAngularRadius : 0),
    shadowDistance: kind === 'directional' ? shadowDistanceOf(p.shadowDistance) : 0,
    fogScattering: p.fogScattering ?? 1,
    temperatureKelvin: p.temperatureKelvin ?? DEFAULT_TEMPERATURE_KELVIN,
  }
}
