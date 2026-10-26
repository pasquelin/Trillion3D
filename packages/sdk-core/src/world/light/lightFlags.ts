import type { Light } from './light.ts'
import { lightChanged } from './lightNumbers.ts'

/**
 * A yes/no setting of a light that is on by default, held as the set of the lights a page turned
 * off — few, so a set and not a field every light would carry. The settings that are off by default
 * are the switches' (`lightAirSettings.ts`).
 */
export function defaultOnFlag(name: string) {
  const off = new WeakSet<Light>()
  return {
    /** Takes what a page's parameters name: the light is off only where they say `false`. */
    take(light: Light, value: boolean | undefined) {
      if (value === false) off.add(light)
    },
    /** Gives `light` the state `source` has. */
    copy(light: Light, source: Light) {
      if (off.has(source)) off.add(light)
      else off.delete(light)
    },
    /** Defines the flag as an accessor of `proto`: a write is noted on the light and reaches the
     *  world at once. */
    define(proto: Light) {
      Object.defineProperty(proto, name, {
        get(this: Light) {
          return !off.has(this)
        },
        set(this: Light, value: boolean) {
          if (value) off.delete(this)
          else off.add(this)
          lightChanged(this)
        },
      })
    },
  }
}
