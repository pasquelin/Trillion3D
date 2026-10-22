/**
 * THE SUN OF THE ATMOSPHERE, AS THE LIGHT STORE KEEPS IT.
 *
 * Of the directional lights that may light the air (`SceneLight.atmosphereSun`, on unless set
 * off) the brightest is the sun: its colour times its intensity, weighed by the eye's sensitivity
 * to each channel (`lightLuminance`, which the fog's sun takes as well); the first added of
 * equals (`lightRanks.ts`: the order of adding, which a removal does not move; the sun held keeps
 * its place against an equal). The atmosphere's block (`atmospherePack.ts`) holds its
 * direction, its illuminance outside the air and its disk; the light a surface receives is that
 * illuminance times the air's transmittance toward the sun, which the store writes into the sun's
 * own slot of the light buffer — the declared light stays as the host declared it.
 */
import { sameValues } from '../../../../math/src/matrix/matrixElements.ts'
import { sameSceneAtmosphere, type ResolvedAtmosphere } from '../core/atmosphere.ts'
import { sunTransmittance, type Rgb } from '../core/atmosphereOptics.ts'
import { ATMOSPHERE_FLOATS, packAtmosphere } from '../core/atmospherePack.ts'
import { LIGHT_SETTINGS, type SceneLight } from './contracts.ts'
import { lightLuminance } from './fields.ts'

/** The id of the sun among `ids`: the brightest directional light not set off, or none. Equals
 *  are settled as lights are added and removed: the sun held (`current`) keeps its place against
 *  an equal, so a light added replaces it only if brighter; else the lowest rank (`rankOf`, the
 *  order of adding) wins, as it does where the sun was removed. */
export function pickAtmosphereSun(
  ids: readonly string[],
  lightOf: (id: string) => SceneLight | undefined,
  rankOf: (id: string) => number,
  current: string | undefined,
) {
  let sun: string | undefined,
    brightest = -1,
    sunRank = Infinity
  for (const id of ids) {
    const light = lightOf(id)
    if (light?.kind !== 'directional' || light.atmosphereSun === false) continue
    const bright = lightLuminance(light)
    const rank = id === current ? -1 : rankOf(id)
    if (bright > brightest || (bright === brightest && rank < sunRank)) {
      brightest = bright
      sun = id
      sunRank = rank
    }
  }
  return sun
}

/** The numbers of a sun the block is made of: its direction, colour, intensity and disk. */
const sunValues = (sun: SceneLight) => [
  ...sun.direction!,
  ...sun.color,
  sun.intensity,
  sun.angularRadius || LIGHT_SETTINGS.sunAngularRadius,
]

const NO_AIR: Rgb = [1, 1, 1]

/** The atmosphere's block in the form a store keeps: written again when the air or the sun
 *  changed, its two versions told apart — the air's alone is what the lookup tables hang on. */
export function createAtmosphereBlock() {
  const packed = new Float32Array(ATMOSPHERE_FLOATS)
  let atmosphere: ResolvedAtmosphere | undefined,
    held: number[] = [],
    tint: Rgb = NO_AIR,
    version = 0,
    epoch = 0
  return {
    /** The block as the GPU reads it. */
    packed,
    /** The air as last set; none, off. */
    get atmosphere() {
      return atmosphere
    },
    /** Bumped when the air changes: what its lookup tables are made from. */
    get version() {
      return version
    },
    /** Bumped when the air or the sun changes: what the sky and the sky light show. */
    get epoch() {
      return epoch
    },
    /** The transmittance of the air toward the sun, one while there is no air or no sun. */
    get tint() {
      return tint
    },
    /** Takes the air and the sun, a record; false when neither changed from the block. */
    update(next: ResolvedAtmosphere | undefined, sun: SceneLight | undefined) {
      const airChanged = !sameSceneAtmosphere(atmosphere, next)
      const values = next && sun ? sunValues(sun) : []
      if (!airChanged && sameValues(values, held)) return false
      if (airChanged) version++
      epoch++
      atmosphere = next
      held = values
      tint = next && sun ? sunTransmittance(next, -sun.direction![1]) : NO_AIR
      packAtmosphere(
        next,
        next && sun
          ? {
              direction: sun.direction!,
              illuminance: [
                sun.color[0] * sun.intensity,
                sun.color[1] * sun.intensity,
                sun.color[2] * sun.intensity,
              ],
              angularRadius: sun.angularRadius || LIGHT_SETTINGS.sunAngularRadius,
            }
          : undefined,
        tint,
        packed,
      )
      return true
    },
  }
}
