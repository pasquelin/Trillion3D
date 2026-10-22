import type { SceneEnvironment } from '../core/environment.ts'
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
  /** The environment's block, which holds the fog's sun. */
  environmentPacked: Float32Array
  /** Writes a light's declared fields into its slot. */
  write: (slot: number, light: SceneLight) => void
}

/**
 * THE BLOCKS THE SUN DECIDES: the atmosphere's block and the sun's colour through the air
 * (`atmosphereSun.ts`), and the fog's sun in the environment's block (`fogSun.ts`). The sun is held
 * as lights are added, changed and removed, air or none; both blocks are written again where a
 * directional light or the environment changed, so a scene with no atmosphere and no fog pays
 * nothing.
 */
export function createSunBlocks(sources: SunSources) {
  const { records, indexOf, environmentPacked, write } = sources
  const air = createAtmosphereBlock()
  const hold = createSunHold(sources.ids, records, sources.rankOf)
  /** The light whose packed colour carries the air's transmittance: the sun, where there is air. */
  let tinted: string | undefined
  /** Writes the atmosphere's block and the sun's colour through the air: the tinted slot is written
   *  again as declared, then the sun's tinted. */
  const applyAtmosphere = () => {
    const environment = sources.environment()
    const previous = tinted === undefined ? undefined : indexOf.get(tinted)
    if (previous !== undefined) write(previous, records.get(tinted!)!)
    tinted = environment?.atmosphere ? hold.sun : undefined
    const sun = tinted === undefined ? undefined : records.get(tinted)
    air.update(environment?.atmosphere, sun)
    const slot = tinted === undefined ? undefined : indexOf.get(tinted)
    if (slot === undefined) return
    const at = baseOf(slot) + LIGHT_FIELD.color
    const packed = sources.packed()
    for (let c = 0; c < 3; c++) packed[at + c] *= air.tint[c]
  }
  /** Writes the fog's sun into the environment's block. */
  const applyFogSun = () => {
    const id = hold.fogSun
    if (sources.environment()?.fog)
      packFogSun(id === undefined ? undefined : records.get(id), environmentPacked)
  }
  /** The sun may have changed: the blocks follow. */
  const settle = () => {
    if (sources.environment()?.atmosphere) applyAtmosphere()
    applyFogSun()
  }
  return {
    /** The atmosphere's block as the GPU reads it, and its versions. */
    air,
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
      if (light.kind === 'directional' || tinted !== undefined) settle()
    },
    /** The environment was set: the atmosphere follows where it is or was the sun's, the fog's sun
     *  always. */
    environmentChanged() {
      if (sources.environment()?.atmosphere || tinted !== undefined) applyAtmosphere()
      applyFogSun()
    },
  }
}
