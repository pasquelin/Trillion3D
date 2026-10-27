// What the tests of the lights' cull share: vectors, the atmosphere's rows, a tile's box and the cull's functions run on the shipped text.
import { ATMOSPHERE_SLOT } from '../../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { scale } from '../../../../../math/src/vector/vectorTuple.fixture.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { cullWgsl } from './cullWgsl.ts'

export type V = number[]

export const atmosphere = (rank: number, perPixel: boolean) => {
  const rows: number[][] = Array.from({ length: ATMOSPHERE_SLOT.planetPlace + 1 }, () => [
    0, 0, 0, 0,
  ])
  rows[ATMOSPHERE_SLOT.sunTransmittance] = [0.9, 0.6, 0.3, 1]
  rows[ATMOSPHERE_SLOT.lightFlags] = [0, 0, perPixel ? 1 : 0, 0]
  rows[ATMOSPHERE_SLOT.lightSlots] = [rank, -1, 0, 0]
  return rows
}

/** The box of a tile whose centre is `centre` (metres), `reach` centimetres to each side, in a card at the world's axes
 *  whose object is in the lighting channels `channels` (a mask, channel 0 alone by default). */
export const tileBox = (centre: V, reach: number, channels = 1) => ({
  card: {
    origin: scale(centre, 100),
    axisX: [1, 0, 0],
    axisY: [0, 1, 0],
    axisZ: [0, 0, 1],
    channels,
  },
  centre: [0, 0, 0],
  reach: [reach, reach, reach],
})

export const cull = (rows: number[][]) =>
  shaderRun<{
    tileLightWeight: (rank: number, light: object, box: object) => number
    lightKey: (weight: number, rank: number, light: object, standalone: boolean) => number
  }>(cullWgsl(4), ['tileLightWeight', 'lightKey'], {
    directLights: { atmosphere: rows },
    lp: { exposure: 1 },
  })
