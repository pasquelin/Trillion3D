// The atmosphere's sky by direction run as shipped (`shaderRun`), the air's tables stood in by clear
// ones (transmittance one, nothing scattered more than once): what the program writes into the
// light buffer's table for the texels asked, read back as the radiance a reader finds there.
import { fromHalf } from '../../../../math/src/float/half.ts'
import { validateSceneAtmosphere } from '../../../../sdk-core/src/scene/core/atmosphere.ts'
import {
  ATMOSPHERE_FLOATS,
  packAtmosphere,
  type AtmosphereSun,
} from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { SKY_CAPTURE, SKY_RAYS } from '../../lighting/atmosphere/layout.ts'
import { DEFAULT_AIR_SHAPE } from '../../lighting/atmosphere/shape.ts'
import { skyRaysProgram } from '../../lighting/atmosphere/skyRaysWgsl.ts'
import { shaderRun } from './shaderRun.fixture.ts'

const unpackHalves = (word: number) => [fromHalf(word & 0xffff), fromHalf(word >>> 16)]

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

/** The sky by direction of the atmosphere `block`: `skyRays`, the table as a reader finds it in the
 *  light buffer, and `at(column)`, the radiance of the texel at `column` of `row`, built by the
 *  program when asked. */
export function skyByDirection(block: Float32Array, row = 40) {
  const skyRays: number[][] = Array.from({ length: SKY_RAYS.azimuth * SKY_RAYS.elevation }, () => [
    0, 0,
  ])
  const { skyRaysMain } = shaderRun<{ skyRaysMain: (id: number[]) => void }>(
    skyRaysProgram(DEFAULT_AIR_SHAPE).code,
    ['skyRaysMain'],
    {
      directLights: { atmosphere: blockRows(block), skyRays },
      frame: { capture: [0, 0, 0, SKY_CAPTURE.altitudeKm] },
      transmittanceAt: () => [1, 1, 1],
      multiScatterAt: () => [0, 0, 0],
    },
  )
  return {
    skyRays,
    at(column: number) {
      skyRaysMain([column, row, 0])
      const [a, b] = skyRays[row * SKY_RAYS.azimuth + column].map(unpackHalves)
      return [...a, b[0]]
    },
  }
}
