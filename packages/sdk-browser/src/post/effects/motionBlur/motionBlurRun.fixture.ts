// What the motion blur's shader tests run on: the blur's uniform, the colours and motions the
// filter reads, and the filter's functions run in JavaScript on the text the engine compiles
// (`kinds.test.ts`).
import assert from 'node:assert/strict'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { gatherShader } from './dilateWgsl.ts'
import { filterShader } from './filterWgsl.ts'
import { filterTwoShader } from './weighTwoWgsl.ts'
import { wgslModule } from '../../../../../math/src/wgsl/assemble.ts'
import { packLight as packLightWgsl } from '../../../gpu/core/smallFloatWgsl.ts'

export type Vec = number[]
export const blurUniform = {
  color: [64, 32, 1 / 64, 1 / 32],
  scale: [16, -8, 1.6, 1 / 16],
  tiles: [4, 2, 4, 2],
  // The samples a pixel takes, the half-resolution gather, the half-size input, the camera's motion
  // taken out.
  knobs: [16, 0, 1, 0],
  grid: [64, 32],
}
export const NONE = () => [0, 0, 0, 0]
export const GREY = () => [0.2, 0.4, 0.6, 1]
export const MOVING = () => [8, 0.5, 5, 0]
export const near = (actual: readonly number[], expected: readonly number[], digits = 5) =>
  assert.deepEqual(
    actual.map((value) => Number(value.toFixed(digits))),
    expected.map((value) => Number(value.toFixed(digits))),
  )

/** The flattened motion's word (`packLight`): `(length, angle, depth)` in. */
const { packLight } = shaderRun<{ packLight: (motion: Vec) => number }>(
  wgslModule(packLightWgsl),
  ['packLight'],
  {},
)
const packFlat = (length: number, angle: number, depth: number) => packLight([length, angle, depth])

/** What the filter's shaders read of an image of 64 × 32 texels, in a `texture` of its size or
 *  larger: the colour from `colour`, the flattened motion (length, angle, depth in metres) from
 *  `flat`, the loads counted. */
function imageScope(
  colour: (x: number, y: number) => Vec,
  flat: (x: number, y: number) => Vec,
  texture: number[],
) {
  const loads = { colour: 0, flat: 0, sampled: [] as Vec[] }
  const scope = {
    mb: blurUniform,
    colorTexture: { load: (at: Vec) => (loads.colour++, colour(at[0], at[1])) },
    flatTexture: {
      load: (at: Vec) => {
        loads.flat++
        const [length, angle, depth] = flat(at[0], at[1])
        return [packFlat(length, angle, depth * 100)]
      },
    },
    colorSampler: {},
    textureDimensions: () => texture,
    textureSampleLevel: (_texture: unknown, _sampler: unknown, uv: Vec) => (
      loads.sampled.push(uv),
      [0.25, 0.5, 0.75, 1]
    ),
  }
  return { scope, loads }
}

/** The filter's functions run in JavaScript on the text the engine compiles, over an image. */
export function filterRun(
  colour: (x: number, y: number) => Vec,
  flat: (x: number, y: number) => Vec,
  texture = [64, 32],
) {
  const { scope, loads } = imageScope(colour, flat, texture)
  const run = shaderRun<{
    gatherStreak: (
      uv: Vec,
      search: Vec,
      noise: number,
      count: number,
      inv: number,
      mip: number,
    ) => Vec
    weighStreak: (
      uv: Vec,
      largest: Vec,
      noise: number,
      count: number,
      mip: number,
    ) => { color: Vec; weight: number }
    colorAt: (uv: Vec, mip: number) => Vec
    finished: (centre: Vec, blend: number, blurred: Vec) => Vec
    tileTexelAt: (uv: Vec, jitter: Vec) => Vec
  }>(filterShader(), ['gatherStreak', 'weighStreak', 'colorAt', 'finished', 'tileTexelAt'], scope)
  return { ...run, loads }
}

/** The weighing of two motions (`weighTwoWgsl.ts`) run in the same way. */
function filterTwoRun(colour: (x: number, y: number) => Vec, flat: (x: number, y: number) => Vec) {
  const { scope } = imageScope(colour, flat, [64, 32])
  return shaderRun<{
    weighStreakTwo: (
      uv: Vec,
      largest: Vec,
      second: Vec,
      noise: number,
      count: number,
      mips: Vec,
      one: boolean,
      inv: number,
    ) => { color: Vec; blend: number }
  }>(filterTwoShader(), ['weighStreakTwo'], scope)
}

/** The pixel the two-motion scenes (`twoStreak`) are of: the texel (32, 16), at its centre. */
const TWO_AT = [32.5 / 64, 16.5 / 32]
/** The motions of a scene, `(length, encoded angle, depth in metres)` by texel: the pixel and its
 *  row move 8 pixels along it (angle 0, encoded 0.5), its column along the column (encoded 0.75)
 *  or not at all, a farther still surface behind half the row; 5.12 m away but there. */
export const TWO_SCENES = {
  row: (x: number, y: number) => (y === 16 ? [8, 0.5, 5.12] : [0, 0.5, 5.12]),
  rowAndColumn: (x: number, y: number) =>
    y === 16 ? [8, 0.5, 5.12] : x === 32 ? [8, 0.75, 5.12] : [0, 0.5, 5.12],
  rowOverSurface: (x: number, y: number) =>
    y !== 16 ? [0, 0.5, 5.12] : x >= 32 ? [8, 0.5, 5.12] : [0, 0.5, 6.4],
}

/** The pixel's streak along two motions, the second along the column by default, 16 samples
 *  jittered by 0.3, over an image whose colour is its texel, `(x / 64, y / 32, 0, 1)`, in the
 *  motions of `scene`; `second` of the first's own is one motion. */
export function twoStreak(scene: (x: number, y: number) => Vec, second = [0, 8]) {
  const colour = (x: number, y: number) => [x / 64, y / 32, 0, 1]
  const { weighStreakTwo } = filterTwoRun(colour, scene)
  const one = second[0] === 8
  return weighStreakTwo(TWO_AT, [8, 0], second, 0.3, 16, [0, 0], one, 1 / 16)
}

/** The spread of the tiles' second largest motions, run over tiles of `ranges` and `seconds`, by
 *  tile key `x,y`: the tile `at` as `(range, second)` — the range as it was, as the drawn spread
 *  leaves it, where `drawn`, else spread. */
export function gatheredSeconds(
  ranges: Record<string, Vec>,
  seconds: Record<string, Vec>,
  at: Vec,
  drawn = false,
) {
  const out = { range: undefined as Vec | undefined, second: undefined as Vec | undefined }
  const rangesOut = {},
    secondsOut = {}
  const none = [0, 0, 0, 0]
  const { dilateGather } = shaderRun<{ dilateGather: (id: Vec) => void }>(
    gatherShader(2, drawn),
    ['dilateGather'],
    {
      mb: { ...blurUniform, scale: [16, -8, 1.6, 1] },
      tilesIn: { load: (tile: Vec) => ranges[tile.join()] ?? none },
      secondsIn: { load: (tile: Vec) => seconds[tile.join()] ?? none },
      centreIn: { load: (tile: Vec) => ranges[`drawn${tile.join()}`] ?? none },
      tilesOut: rangesOut,
      secondsOut,
      textureStore: (texture: object, _tile: Vec, value: Vec) => {
        if (texture === rangesOut) out.range = value
        else out.second = value
      },
    },
  )
  dilateGather([...at, 0])
  return out
}

/** The same pixel weighed along its row alone, as the classes of one motion weigh it. */
export const weighedStreak = (scene: (x: number, y: number) => Vec) =>
  filterRun((x, y) => [x / 64, y / 32, 0, 1], scene).weighStreak(TWO_AT, [8, 0], 0.3, 16, 0)
