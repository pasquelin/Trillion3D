import {
  type SceneEnvironment,
  SCENE_ENVIRONMENT_FLOATS,
  packEnvironment,
} from '../core/environment.ts'
import { sameSceneEnvironment } from './equal.ts'

/** What of an environment carries light: neither the fog, the sharpening nor the vignette does,
 *  so a change of theirs alone moves no transport. */
const transportOf = (e: SceneEnvironment) => ({
  ...e,
  fog: undefined,
  sharpness: undefined,
  vignette: undefined,
})

/** What `set` found: the environment it was given is the one held (`'same'`), differs from it by
 *  what carries no light only (`'untransported'`), or moves light transport (`'transported'`). */
export type EnvironmentChange = 'same' | 'untransported' | 'transported'

/**
 * THE ENVIRONMENT A LIGHT STORE HOLDS: the validated value and the block it is packed into for
 * the GPU, the irradiance's behind the lights (`../core/environment.ts`).
 */
export function createEnvironmentBlock() {
  const packed = new Float32Array(SCENE_ENVIRONMENT_FLOATS)
  let held: SceneEnvironment | undefined
  return {
    packed,
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
      return untransported ? 'untransported' : 'transported'
    },
  }
}
