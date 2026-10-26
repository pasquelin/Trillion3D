import type { SceneLight } from '../../scene/light/contracts.ts'
import { LIGHT_SETTINGS } from '../../scene/light/contracts.ts'
import { DEFAULT_LIGHT_UNITS, LIGHT_UNITS, type LightUnits } from '../../scene/light/lightUnits.ts'
import { EngineError } from '../../contracts/cache.ts'
import { defaultOnFlag } from './lightFlags.ts'
import { lightChanged } from './lightNumbers.ts'
import type { Light } from './light.ts'

/** The settings of a lamp that say how its light falls off and how much of it it gives, held beside
 *  the light's own numbers (`lightNumbers.ts`): the yes/no one that is on by default, whether it
 *  falls off as the inverse square of the distance. */
const inverseSquared = defaultOnFlag('inverseSquared')

/** The lamps whose intensity a page wrote in another unit than unitless (`Light.intensityUnits`):
 *  few, so a map and not a field every light would carry. */
const UNITS = new WeakMap<Light, LightUnits>()

/** Holds `units` for `light`, refused unless one of `LIGHT_UNITS`. */
function setUnits(light: Light, units: LightUnits) {
  if (!LIGHT_UNITS.includes(units))
    throw new EngineError(
      'INVALID_SCENE_LIGHT',
      `${light.name || 'light'}: unknown intensityUnits`,
      {
        units,
      },
    )
  if (units === DEFAULT_LIGHT_UNITS) UNITS.delete(light)
  else UNITS.set(light, units)
}

/** Takes the fall-off and the intensity's unit `p` names for `light`: the fall-off off only where
 *  `p` says `false`. */
export function takeLamp(
  light: Light,
  p: { inverseSquared?: boolean; intensityUnits?: LightUnits },
) {
  inverseSquared.take(light, p.inverseSquared)
  if (p.intensityUnits !== undefined) setUnits(light, p.intensityUnits)
}

/** Gives `light` the fall-off and the intensity's unit `source` has. */
export function copyLamp(light: Light, source: Light) {
  inverseSquared.copy(light, source)
  setUnits(light, source.intensityUnits)
}

/** Defines `inverseSquared` and `intensityUnits` as accessors of `proto`: a write is noted on the
 *  light and reaches the world at once. */
export function defineLampSettings(proto: Light) {
  inverseSquared.define(proto)
  Object.defineProperty(proto, 'intensityUnits', {
    get(this: Light) {
      return UNITS.get(this) ?? DEFAULT_LIGHT_UNITS
    },
    set(this: Light, units: LightUnits) {
      setUnits(this, units)
      lightChanged(this)
    },
  })
}

/** Writes into `record` the unit a point, spot or rect `light` writes its intensity in, only where
 *  it is not the default. */
export function recordUnits(light: Light, record: SceneLight) {
  if (record.kind !== 'directional' && light.intensityUnits !== DEFAULT_LIGHT_UNITS)
    record.intensityUnits = light.intensityUnits
}

/** Writes into `record` what a point or a spot `light` sets of how its light falls off, each only
 *  where it is not the default: a light that names none keeps the record it had. */
export function recordFalloff(light: Light, record: SceneLight) {
  if (!light.inverseSquared) record.inverseSquared = false
  if (light.radialExponent !== LIGHT_SETTINGS.radialExponent)
    record.radialExponent = light.radialExponent
}

/** Writes into `record` the shares of its diffuse and specular light `light` gives, each only where
 *  it is not 1. */
export function recordShares(light: Light, record: SceneLight) {
  if (light.diffuseShare !== 1) record.diffuseShare = light.diffuseShare
  if (light.specularShare !== 1) record.specularShare = light.specularShare
}
