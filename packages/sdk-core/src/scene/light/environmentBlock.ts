import {
  type SceneEnvironment,
  SCENE_ENVIRONMENT_FLOATS,
  packEnvironment,
} from '../core/environment.ts'
import { SKY_FLOATS, packSky, skyOfTransport } from '../core/environmentSky.ts'
import { sameSceneEnvironment } from './equal.ts'

/** What of an environment carries light: neither the fog, the sharpening, the vignette nor the sky
 *  light's own irradiance (the probes read the sky by direction) does, so a change of theirs alone
 *  moves no transport. */
const transportOf = (e: SceneEnvironment) => ({
  ...e,
  fog: undefined,
  sharpness: undefined,
  vignette: undefined,
  sky: skyOfTransport(e.sky),
})

/** What `set` found: the environment it was given is the one held (`'same'`), differs from it by
 *  what carries no light only (`'untransported'`), or moves light transport (`'transported'`). */
export type EnvironmentChange = 'same' | 'untransported' | 'transported'

/**
 * THE ENVIRONMENT A LIGHT STORE HOLDS: the validated value and the two blocks it is packed into for
 * the GPU, the irradiance's behind the lights (`../core/environment.ts`) and the sky the probes and
 * the reflections read behind it (`../core/environmentSky.ts`).
 */
export function createEnvironmentBlock() {
  const packed = new Float32Array(SCENE_ENVIRONMENT_FLOATS)
  const sky = new Float32Array(SKY_FLOATS)
  let held: SceneEnvironment | undefined
  return {
    packed,
    sky,
    /** The environment held, none until one is set. */
    get current() {
      return held
    },
    /** Holds an environment already validated and packs it, and says what it changed. */
    set(next: SceneEnvironment): EnvironmentChange {
      if (held && sameSceneEnvironment(held, next)) return 'same'
      const untransported = held && sameSceneEnvironment(transportOf(held), transportOf(next))
      held = next
      packEnvironment(held, packed)
      packSky(held.sky, sky)
      return untransported ? 'untransported' : 'transported'
    },
  }
}
