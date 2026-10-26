// An atmosphere's block as a test builds it: a light of the air, the block of an Earth-like air lit
// by lights, and the block as the `vec4` rows the shaders index.
import { validateSceneAtmosphere } from '../../../../sdk-core/src/scene/core/atmosphere.ts'
import {
  ATMOSPHERE_FLOATS,
  packAtmosphere,
  type AtmosphereSun,
} from '../../../../sdk-core/src/scene/core/atmospherePack.ts'

/** A light of the air toward `toward`, of `lux` in every channel, the air clear toward it. */
export const airLight = (toward: number[], lux: number): AtmosphereSun => ({
  direction: toward.map((c) => -c),
  illuminance: [lux, lux, lux],
  angularRadius: 0.00467,
  transmittance: [1, 1, 1],
})

/** The block of an Earth-like atmosphere lit by these lights, by index of the air. */
export const airBlock = (...lights: AtmosphereSun[]) =>
  packAtmosphere(validateSceneAtmosphere(true), lights, new Float32Array(ATMOSPHERE_FLOATS))

/** The atmosphere's block `block` (`packAtmosphere`) as the `vec4` rows the shaders index. */
export const blockRows = (block: Float32Array) =>
  Array.from({ length: block.length / 4 }, (_, i) => Array.from(block.subarray(i * 4, i * 4 + 4)))
