/**
 * THE SUNS OF THE ATMOSPHERE, AS THE LIGHT STORE KEEPS THEM.
 *
 * Of the directional lights that may light the air (`SceneLight.atmosphereSun`, on unless set
 * off) one is held for each index of the air (`SceneLight.atmosphereSunIndex`, 0 unless set: the
 * sun, and a second light, a moon), whether or not an atmosphere is set (the fog scatters the one
 * of index 0, `fogSun.ts`): a light added takes the place of its index only if it is strictly
 * brighter — its colour times its intensity, weighed by the eye's sensitivity to each channel
 * (`lightLuminance`) —, and the light removed gives it to the brightest of the others of its index,
 * the first added of equals (`lightRanks.ts`: the order of adding, which a removal does not move).
 * A change of a light's colour, brightness or direction never chooses again; one that makes a light
 * able or unable to light the air, or moves it to the other index, is its removal and its adding
 * again. The atmosphere's block (`atmospherePack.ts`) holds, for each light, its direction, its
 * illuminance outside the air and its disk; the light a surface receives is that illuminance times
 * the air's transmittance toward the light, which the store writes into the light's own slot of the
 * light buffer — the declared light stays as the host declared it.
 */
import { sameValues } from '../../../../math/src/matrix/matrixElements.ts'
import { sameSceneAtmosphere, type ResolvedAtmosphere } from '../core/atmosphere.ts'
import { sunTransmittance, type Rgb } from '../core/atmosphereOptics.ts'
import { ATMOSPHERE_FLOATS, packAtmosphere } from '../core/atmospherePack.ts'
import {
  ATMOSPHERE_SUN_INDICES,
  LIGHT_SETTINGS,
  type AtmosphereSunIndex,
  type SceneLight,
} from './contracts.ts'
import { atmosphereSunIndexOf, lightLuminance } from './fields.ts'

/** Whether a light may light the air: a directional one not set off. */
const mayLightAir = (light: SceneLight) =>
  light.kind === 'directional' && light.atmosphereSun !== false

/** The brightest light of `ids` (their `records`, `rankOf` their order of adding) that may light the
 *  air as the light of `index`, the lowest rank of equals: the light chosen again when the one held
 *  is removed. */
function brightestLighting(
  ids: readonly string[],
  records: ReadonlyMap<string, SceneLight>,
  rankOf: (id: string) => number,
  index: number,
  except?: string,
) {
  let best: string | undefined,
    luminance = -1,
    rank = Infinity
  for (const id of ids) {
    const light = records.get(id)!
    if (id === except || !mayLightAir(light) || atmosphereSunIndexOf(light) !== index) continue
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

/** Whether a light takes the place of the one held for an index (`held`, none where there is
 *  none): only if strictly brighter. */
const outshines = (
  records: ReadonlyMap<string, SceneLight>,
  light: SceneLight,
  held: string | undefined,
) => held === undefined || lightLuminance(light) > lightLuminance(records.get(held)!)

/**
 * The lights held among the lights of a store (`ids`, their `records`, `rankOf` their order of
 * adding), one for each index of the air, and the directional light the fog falls back on where
 * none of index 0 may light the air: the first added, until it is removed. Lights that are not
 * directional are none of its concern.
 */
export function createSunHold(
  ids: readonly string[],
  records: ReadonlyMap<string, SceneLight>,
  rankOf: (id: string) => number,
) {
  /** The light held for each index, none where there is no candidate. */
  const suns: (string | undefined)[] = ATMOSPHERE_SUN_INDICES.map(() => undefined)
  let first: string | undefined
  /** The directional lights, as last added or changed, each with the index it was added for: none
   *  for a light that may not light the air. */
  const directional = new Map<string, AtmosphereSunIndex | undefined>()
  /** A light was added, its record held: it takes the place of its index only if strictly
   *  brighter. */
  const added = (light: SceneLight) => {
    if (light.kind !== 'directional') return
    first ??= light.id
    const index = mayLightAir(light) ? atmosphereSunIndexOf(light) : undefined
    directional.set(light.id, index)
    if (index !== undefined && outshines(records, light, suns[index])) suns[index] = light.id
  }
  /** A light was removed (`except`: a light changed, still among `ids`, that is being added
   *  again): the brightest of the others of its index takes its place if it was held. */
  const removed = (id: string, except?: string) => {
    directional.delete(id)
    if (first === id) first = undefined
    const index = suns.indexOf(id)
    if (index >= 0) suns[index] = brightestLighting(ids, records, rankOf, index, except)
  }
  return {
    /** The ids of the lights held, by index of the air; none where there is none. */
    get suns(): readonly (string | undefined)[] {
      return suns
    },
    /** The id of the light the fog scatters: the one of index 0, else the first directional light
     *  added. */
    get fogSun() {
      return suns[0] ?? first
    },
    added,
    removed,
    /** A light was changed, its record held: the lights held stay where they are, unless the light
     *  became or stopped being directional or able to light the air, or moved to the other index —
     *  then it is removed and added again. */
    changed(light: SceneLight) {
      const index = mayLightAir(light) ? atmosphereSunIndexOf(light) : undefined
      if (
        directional.has(light.id) === (light.kind === 'directional') &&
        directional.get(light.id) === index
      )
        return
      removed(light.id, light.id)
      added(light)
    },
  }
}

/** The numbers of a light the block is made of: whether there is one, then its direction, colour,
 *  intensity and disk. */
const sunValues = (sun: SceneLight | undefined) =>
  sun
    ? [
        1,
        ...sun.direction!,
        ...sun.color,
        sun.intensity,
        sun.angularRadius || LIGHT_SETTINGS.sunAngularRadius,
      ]
    : [0]

const NO_AIR: Rgb = [1, 1, 1]

/** A light as the block packs it, with the transmittance of the air toward it. */
const packedSun = (sun: SceneLight, transmittance: Rgb) => ({
  direction: sun.direction!,
  illuminance: [
    sun.color[0] * sun.intensity,
    sun.color[1] * sun.intensity,
    sun.color[2] * sun.intensity,
  ] as Rgb,
  angularRadius: sun.angularRadius || LIGHT_SETTINGS.sunAngularRadius,
  transmittance,
})

/** The atmosphere's block in the form a store keeps: written again when the air or its lights
 *  changed, its two versions told apart — the air's alone is what the lookup tables hang on. */
export function createAtmosphereBlock() {
  const packed = new Float32Array(ATMOSPHERE_FLOATS)
  let atmosphere: ResolvedAtmosphere | undefined,
    held: number[] = [],
    tints: Rgb[] = ATMOSPHERE_SUN_INDICES.map(() => NO_AIR),
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
    /** Bumped when the air or a light of it changes: what the sky and the sky light show. */
    get epoch() {
      return epoch
    },
    /** The transmittance of the air toward each light, by index, one while there is no air or no
     *  light. */
    get tints(): readonly Rgb[] {
      return tints
    },
    /** Takes the air and the lights held, by index of the air, records; false when neither changed
     *  from the block. */
    update(next: ResolvedAtmosphere | undefined, suns: readonly (SceneLight | undefined)[]) {
      const airChanged = !sameSceneAtmosphere(atmosphere, next)
      const values = next ? suns.flatMap(sunValues) : []
      if (!airChanged && sameValues(values, held)) return false
      if (airChanged) version++
      epoch++
      atmosphere = next
      held = values
      tints = suns.map((sun) => (next && sun ? sunTransmittance(next, -sun.direction![1]) : NO_AIR))
      packAtmosphere(
        next,
        suns.map((sun, index) => (next && sun ? packedSun(sun, tints[index]) : undefined)),
        packed,
      )
      return true
    },
  }
}
