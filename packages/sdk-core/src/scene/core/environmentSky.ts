/**
 * THE SKY, AS THE LIGHT BUFFER HOLDS IT: what a surface and a ray that leaves the scene read of the
 * sky, apart from the light that comes from every direction at once (`environment.ts`).
 *
 * The sky lights a surface two ways. Where the bounce probes answer, they carry it: a probe ray
 * that leaves the scene returns the sky in its direction, so the probes hold the sky the scene
 * lets through — the streets lit from above, the arcades dark. Where they do not answer — no
 * probes, a point no cascade reaches — the sky light's own irradiance stands in, the sky nothing
 * hides. A ray of a reflection that leaves the scene reads the sky too, in its direction, sharp.
 *
 * Eleven `vec4`, written by the CPU whenever the sky light or the scene's sky changes: the nine
 * coefficients of the sky light's irradiance (the layout of `SceneEnvironment.irradiance`), then
 * the radiance of the sky above the horizon — a factor of the atmosphere's sky, or with no air the
 * sky's own colour — whose `w` is 1 where a sky light gives the sky to the probes, then the radiance
 * below the horizon, whose `w` is 1 where the sky is shown at all (a reflection reads it).
 */
import { EngineError } from '../../contracts/cache.ts'
import { sameValues } from '../../../../math/src/matrix/matrixElements.ts'
import { finite } from './fog.ts'

/** The sky of a scene, every field set. */
export interface SceneSky {
  /** The sky light's irradiance on a surface the probes do not answer: 27 numbers, as
   *  `SceneEnvironment.irradiance`; all zero where no sky light is. */
  irradiance: readonly number[]
  /** The radiance of the sky above the horizon: a factor of the atmosphere's sky, or the sky's own
   *  colour where the scene has no air. Three numbers, each zero or more. */
  upper: readonly number[]
  /** The radiance below the horizon, black unless a sky light gives it a ground colour. */
  lower: readonly number[]
  /** Whether a sky light gives the sky to the bounce probes: the atmosphere alone is seen by
   *  the reflections, and lights nothing. */
  light: boolean
}

/** The `vec4` slots of the block, by number: the shaders read them by these. */
export const SKY_SLOT = { irradiance: 0, upper: 9, lower: 10 } as const
/** `vec4` slots of the block, and its floats. Written as literals, so a bundle that reads none of
 *  them keeps none. */
export const SKY_SLOTS = 11
export const SKY_FLOATS = 44

/** Two skies, both absent or identical field by field. */
export function sameSceneSky(a: SceneSky | undefined, b: SceneSky | undefined) {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.light === b.light &&
    sameValues(a.irradiance, b.irradiance) &&
    sameValues(a.upper, b.upper) &&
    sameValues(a.lower, b.lower)
  )
}

const NO_IRRADIANCE: readonly number[] = /* @__PURE__ */ (() => new Array<number>(27).fill(0))()
/** The sky without the sky light's own irradiance, which no probe reads — they read the sky by
 *  direction —: what light transport follows (`SceneLightStore.transportEpoch`). */
export const skyOfTransport = (sky: SceneSky | undefined) =>
  sky && { ...sky, irradiance: NO_IRRADIANCE }

/** Checks a sky's fields, a copy of them. */
export function validateSceneSky(sky: SceneSky): SceneSky {
  const colour = (name: string, value: readonly number[]) => {
    if (value?.length !== 3 || !value.every((c) => finite(c) && c >= 0))
      throw new EngineError(
        'INVALID_SCENE_ENVIRONMENT',
        `sky ${name} expects 3 numbers, 0 or more`,
        {
          [name]: value,
        },
      )
    return [...value]
  }
  if (sky.irradiance?.length !== 27 || !sky.irradiance.every(finite))
    throw new EngineError('INVALID_SCENE_ENVIRONMENT', 'sky irradiance expects 27 finite numbers', {
      length: sky.irradiance?.length,
    })
  return {
    irradiance: [...sky.irradiance],
    upper: colour('upper', sky.upper),
    lower: colour('lower', sky.lower),
    light: sky.light === true,
  }
}

/** Writes the block into `out` (`SKY_FLOATS` floats): all zero without a sky. */
export function packSky(sky: SceneSky | undefined, out: Float32Array) {
  out.fill(0)
  if (!sky) return out
  for (let k = 0; k < 9; k++)
    for (let c = 0; c < 3; c++) out[(SKY_SLOT.irradiance + k) * 4 + c] = sky.irradiance[k * 3 + c]
  out.set(sky.upper, SKY_SLOT.upper * 4)
  out[SKY_SLOT.upper * 4 + 3] = sky.light ? 1 : 0
  out.set(sky.lower, SKY_SLOT.lower * 4)
  out[SKY_SLOT.lower * 4 + 3] = 1
  return out
}
