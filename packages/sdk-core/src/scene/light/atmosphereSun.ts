/**
 * THE SUN OF THE ATMOSPHERE, AS THE LIGHT STORE KEEPS IT.
 *
 * Of the directional lights that may light the air (`SceneLight.atmosphereSun`, on unless set
 * off) one is the sun, held as lights come and go, whether or not an atmosphere is set (the fog
 * scatters it too, `fogSun.ts`): a light added takes the place only if it is strictly brighter —
 * its colour times its intensity, weighed by the eye's sensitivity to each channel
 * (`lightLuminance`) —, and the sun removed gives it to the brightest of the others, the first
 * added of equals (`lightRanks.ts`: the order of adding, which a removal does not move). A change of a light's
 * colour, brightness or direction never chooses the sun again; one that makes a light able or
 * unable to light the air is its removal and its adding again. The
 * atmosphere's block (`atmospherePack.ts`) holds its direction, its illuminance outside the air and
 * its disk; the light a surface receives is that illuminance times the air's transmittance toward
 * the sun, which the store writes into the sun's own slot of the light buffer — the declared light
 * stays as the host declared it.
 */
import { sameValues } from '../../../../math/src/matrix/matrixElements.ts'
import { sameSceneAtmosphere, type ResolvedAtmosphere } from '../core/atmosphere.ts'
import { sunTransmittance, type Rgb } from '../core/atmosphereOptics.ts'
import { ATMOSPHERE_FLOATS, packAtmosphere } from '../core/atmospherePack.ts'
import { LIGHT_SETTINGS, type SceneLight } from './contracts.ts'
import { lightLuminance } from './fields.ts'

/** Whether a light may light the air: a directional one not set off. */
const mayLightAir = (light: SceneLight) =>
  light.kind === 'directional' && light.atmosphereSun !== false

/** The brightest light of `ids` (their `records`, `rankOf` their order of adding) that may light the
 *  air, the lowest rank of equals: the sun chosen again when the one held is removed. */
function brightestLighting(
  ids: readonly string[],
  records: ReadonlyMap<string, SceneLight>,
  rankOf: (id: string) => number,
) {
  let best: string | undefined,
    luminance = -1,
    rank = Infinity
  for (const id of ids) {
    const light = records.get(id)!
    if (!mayLightAir(light)) continue
    const bright = lightLuminance(light),
      at = rankOf(id)
    if (bright > luminance || (bright === luminance && at < rank)) {
      best = id
      luminance = bright
      rank = at
    }
  }
  return best
}

/**
 * The sun held among the lights of a store (`ids`, their `records`, `rankOf` their order of
 * adding), and the directional light the fog falls back on where none may light the air: the
 * first added, until it is removed. Lights that are not directional are none of its concern.
 */
export function createSunHold(
  ids: readonly string[],
  records: ReadonlyMap<string, SceneLight>,
  rankOf: (id: string) => number,
) {
  let sun: string | undefined, first: string | undefined
  /** The lights that may light the air, as last added or changed. */
  const lighting = new Set<string>()
  const brightest = () => brightestLighting(ids, records, rankOf)
  /** A light was added, its record held: it takes the sun's place only if strictly brighter. */
  const added = (light: SceneLight) => {
    if (light.kind === 'directional') first ??= light.id
    if (!mayLightAir(light)) return
    lighting.add(light.id)
    if (sun === undefined || lightLuminance(light) > lightLuminance(records.get(sun)!))
      sun = light.id
  }
  return {
    /** The id of the atmosphere's sun, or none. */
    get sun() {
      return sun
    },
    /** The id of the light the fog scatters: the sun, else the first directional light added. */
    get fogSun() {
      return sun ?? first
    },
    added,
    /** A light was removed, no longer among `ids`: the brightest of the others takes the sun's
     *  place if it was the sun. */
    removed(id: string) {
      lighting.delete(id)
      if (first === id) first = undefined
      if (sun === id) sun = brightest()
    },
    /** A light was changed, its record held: the sun stays where it is, unless the light became
     *  able or unable to light the air — then it is removed or added again. */
    changed(light: SceneLight) {
      if (light.kind !== 'directional' && first === light.id) first = undefined
      if (mayLightAir(light) === lighting.has(light.id)) return
      if (lighting.has(light.id)) {
        lighting.delete(light.id)
        if (sun === light.id) sun = brightest()
      } else added(light)
    },
  }
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
