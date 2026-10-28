import type { Light } from './light.ts'
import { lightChanged } from './lightNumbers.ts'

/**
 * A yes/no setting of a light, held as the set of the lights a page turned against its default
 * (`defaultOn`) — few, so a set and not a field every light would carry.
 */
export function lightFlag(name: string, defaultOn: boolean) {
  const against = new WeakSet<Light>()
  return {
    /** Takes what a page's parameters name: the light is against the default only where they say
     *  so — `false` for a flag on by default, any true value for one off. */
    take(light: Light, value: boolean | undefined) {
      if (defaultOn ? value === false : value) against.add(light)
    },
    /** Gives `light` the state `source` has. */
    copy(light: Light, source: Light) {
      if (against.has(source)) against.add(light)
      else against.delete(light)
    },
    /** Defines the flag as an accessor of `proto`: a write is noted on the light and reaches the
     *  world at once. */
    define(proto: Light) {
      Object.defineProperty(proto, name, {
        get(this: Light) {
          return against.has(this) !== defaultOn
        },
        set(this: Light, value: boolean) {
          if (!!value === defaultOn) against.delete(this)
          else against.add(this)
          lightChanged(this)
        },
      })
    },
  }
}
