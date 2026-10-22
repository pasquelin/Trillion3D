import type { SceneEnvironment } from '../core/environment.ts'
import type { ResolvedAtmosphere } from '../core/atmosphere.ts'
import type { Rgb } from '../core/atmosphereOptics.ts'
import { createAtmosphereBlock, createSunHold } from './atmosphereSun.ts'
import type { SceneLight } from './contracts.ts'
import { LIGHT_FIELD, baseOf } from './fields.ts'
import { packFogSun } from './fogSun.ts'

/** What the sun's blocks read of the light store, and how they write a light into it. */
type SunSources = {
  ids: readonly string[]
  records: ReadonlyMap<string, SceneLight>
  indexOf: ReadonlyMap<string, number>
  /** A light's rank, the order of adding (`lightRanks.ts`): what settles equals. */
  rankOf: (id: string) => number
  /** The packed lights: a new array when the table grows. */
  packed: () => Float32Array
  /** The scene's environment, none until it is set. */
  environment: () => SceneEnvironment | undefined
  /** The air the lights go through: the environment's atmosphere, none where it is off
   *  (`SceneLightStore.setAirOn`). */
  atmosphere: () => ResolvedAtmosphere | undefined
  /** The environment's block, which holds the fog's sun. */
  environmentPacked: Float32Array
  /** Writes a light's declared fields into its slot. */
  write: (slot: number, light: SceneLight) => void
}

/** What `map` holds for `id`, none for none. */
const heldBy = <T>(map: ReadonlyMap<string, T>, id: string | undefined) =>
  id === undefined ? undefined : map.get(id)

/** Multiplies the colour of the light in `slot` of the packed lights by `tint`, per channel. */
function tintSlot(packed: Float32Array, slot: number, tint: Rgb) {
  const at = baseOf(slot) + LIGHT_FIELD.color
  for (let c = 0; c < 3; c++) packed[at + c] *= tint[c]
}

/**
 * THE COLOUR OF EACH LIGHT OF THE AIR THROUGH IT: the atmosphere's block written again and the
 * packed colour of each light held multiplied by the air's transmittance toward it, where there is
 * air. The lights tinted are kept, by index of the air, to be written again as declared when they
 * are no longer held, or the air is gone.
 */
function createTints(
  sources: SunSources,
  air: ReturnType<typeof createAtmosphereBlock>,
  hold: ReturnType<typeof createSunHold>,
) {
  const { records, indexOf, write } = sources
  let tinted: (string | undefined)[] = []
  return {
    /** Whether a light's colour carries the air's tint. */
    get any() {
      return tinted.some((id) => id !== undefined)
    },
    /** Writes the atmosphere's block and the tint of each light held. */
    apply() {
      const atmosphere = sources.atmosphere()
      for (const id of tinted) {
        const previous = heldBy(indexOf, id)
        if (previous !== undefined) write(previous, heldBy(records, id)!)
      }
      tinted = atmosphere ? [...hold.suns] : []
      air.update(
        atmosphere,
        hold.suns.map((id) => heldBy(records, id)),
        hold.suns.map((id) => heldBy(indexOf, id)),
      )
      const packed = sources.packed()
      tinted.forEach((id, index) => {
        const slot = heldBy(indexOf, id)
        if (slot !== undefined) tintSlot(packed, slot, air.tints[index])
      })
    },
  }
}

/**
 * THE BLOCKS THE SUNS DECIDE: the atmosphere's block and the colour of each of the air's lights
 * through the air (`atmosphereSun.ts`), and the fog's sun in the environment's block
 * (`fogSun.ts`). The lights are held as lights are added, changed and removed, air or none; both
 * blocks are written again where a directional light or the environment changed, so a scene with
 * no atmosphere and no fog pays nothing.
 */
export function createSunBlocks(sources: SunSources) {
  const { records, environmentPacked } = sources
  const air = createAtmosphereBlock()
  const hold = createSunHold(sources.ids, records, sources.rankOf)
  const tints = createTints(sources, air, hold)
  /** Writes the fog's sun into the environment's block. */
  const applyFogSun = () => {
    if (sources.environment()?.fog) packFogSun(heldBy(records, hold.fogSun), environmentPacked)
  }
  /** The sun may have changed: the blocks follow. */
  const settle = () => {
    if (sources.atmosphere()) tints.apply()
    applyFogSun()
  }
  return {
    /** The atmosphere's block as the GPU reads it, and its versions. */
    air,
    /** The slot of the light the fog scatters — the volume's sun as the analytic fog's lobe —, −1
     *  where there is none. */
    get fogSunSlot() {
      return heldBy(sources.indexOf, hold.fogSun) ?? -1
    },
    /** The record of the light held for the air's light `index` (0 or 1), none where there is none. */
    held: (index: number) => heldBy(records, hold.suns[index]),
    /** A light was added, held in the store. */
    added(light: SceneLight) {
      hold.added(light)
      if (light.kind === 'directional') settle()
    },
    /** A light was changed (`previous` as it was, `next` held now). */
    changed(previous: SceneLight, next: SceneLight) {
      hold.changed(next)
      if (previous.kind === 'directional' || next.kind === 'directional') settle()
    },
    /** A light was removed from the store. */
    removed(light: SceneLight) {
      hold.removed(light.id)
      // A light that moved into the tinted slot overwrote its tint.
      if (light.kind === 'directional' || tints.any) settle()
    },
    /** The environment was set: the atmosphere follows where it is or was the sun's, the fog's sun
     *  always. */
    environmentChanged() {
      if (sources.atmosphere() || tints.any) tints.apply()
      applyFogSun()
    },
  }
}
