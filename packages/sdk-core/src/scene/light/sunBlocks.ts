import type { SceneEnvironment } from '../core/environment.ts'
import { createAtmosphereBlock, pickAtmosphereSun } from './atmosphereSun.ts'
import type { SceneLight } from './contracts.ts'
import { LIGHT_FIELD, baseOf } from './fields.ts'
import { packFogSun, pickFogSun } from './fogSun.ts'

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
 * (`atmosphereSun.ts`), and the fog's sun in the environment's block (`fogSun.ts`). Both are written
 * again where a directional light or the environment changed (`touched`, `environmentChanged`), so a
 * scene with no atmosphere and no fog pays nothing.
 */
export function createSunBlocks(sources: SunSources) {
  const { ids, records, indexOf, rankOf, environmentPacked, write } = sources
  const air = createAtmosphereBlock()
  /** The light whose packed colour carries the air's transmittance: the atmosphere's sun. */
  let sunId: string | undefined
  /** Writes the atmosphere's block and the sun's colour through the air: the sun's slot is written
   *  again as declared, then tinted. */
  const applyAtmosphere = () => {
    const environment = sources.environment()
    const previous = sunId === undefined ? undefined : indexOf.get(sunId)
    if (previous !== undefined) write(previous, records.get(sunId!)!)
    sunId = environment?.atmosphere
      ? pickAtmosphereSun(ids, (id) => records.get(id), rankOf, sunId)
      : undefined
    const sun = sunId === undefined ? undefined : records.get(sunId)
    air.update(environment?.atmosphere, sun)
    const slot = sunId === undefined ? undefined : indexOf.get(sunId)
    if (slot === undefined) return
    const at = baseOf(slot) + LIGHT_FIELD.color
    const packed = sources.packed()
    for (let c = 0; c < 3; c++) packed[at + c] *= air.tint[c]
  }
  /** Writes the fog's sun into the environment's block, after the atmosphere's sun is picked. */
  const applyFogSun = () => {
    if (sources.environment()?.fog)
      packFogSun(
        pickFogSun(ids, (id) => records.get(id), rankOf, sunId),
        environmentPacked,
      )
  }
  return {
    /** The atmosphere's block as the GPU reads it, and its versions. */
    air,
    /** Whether a light is the atmosphere's sun now: one that moves in the buffer, as a light is
     *  removed, moves it. */
    get picked() {
      return sunId !== undefined
    },
    /** A directional light — or the sun's slot — was added, changed or removed: the blocks follow. */
    touched(directional: boolean) {
      if (!directional) return
      if (sources.environment()?.atmosphere) applyAtmosphere()
      applyFogSun()
    },
    /** The environment was set: the atmosphere follows where it is or was the sun's, the fog's sun
     *  always. */
    environmentChanged() {
      if (sources.environment()?.atmosphere || sunId !== undefined) applyAtmosphere()
      applyFogSun()
    },
  }
}
