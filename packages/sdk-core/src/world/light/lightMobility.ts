import type { Light } from './light.ts'
import { lightChanged } from './lightNumbers.ts'
import {
  DEFAULT_LIGHT_MOBILITY,
  LIGHT_MOBILITY,
  type LightMobility,
} from '../../scene/light/contracts.ts'
import { EngineError } from '../../contracts/cache.ts'

/**
 * The mobility of the lights (`Light.mobility`), held as the set of the lights a page set against the
 * default (`DEFAULT_LIGHT_MOBILITY`) — few, so a map and not a field every light would carry.
 */
const SET = new WeakMap<Light, LightMobility>()

/** `value`, refused (`INVALID_SCENE_LIGHT`) unless it is one of `LIGHT_MOBILITY`. */
function checked(value: unknown, name: string): LightMobility {
  if (!LIGHT_MOBILITY.includes(value as LightMobility))
    throw new EngineError(
      'INVALID_SCENE_LIGHT',
      `${name}: mobility expects ${LIGHT_MOBILITY.join(', ')}`,
      { mobility: value },
    )
  return value as LightMobility
}

function hold(light: Light, value: LightMobility) {
  if (value === DEFAULT_LIGHT_MOBILITY) SET.delete(light)
  else SET.set(light, value)
}

export const lightMobility = {
  /** Takes what a page's parameters name. */
  take(light: Light, value: LightMobility | undefined) {
    if (value !== undefined) hold(light, checked(value, light.name || 'light'))
  },
  /** Gives `light` the mobility `source` has. */
  copy(light: Light, source: Light) {
    hold(light, source.mobility)
  },
  /** Defines `mobility` as an accessor of `proto`: a write is noted on the light and reaches the
   *  world at once. */
  define(proto: Light) {
    Object.defineProperty(proto, 'mobility', {
      get(this: Light): LightMobility {
        return SET.get(this) ?? DEFAULT_LIGHT_MOBILITY
      },
      set(this: Light, value: LightMobility) {
        hold(this, checked(value, this.name || 'light'))
        lightChanged(this)
      },
    })
  },
}
