// The shading rejection's network run in JavaScript from the shipped text: the program, the tile
// its lanes share, and the operators as one lane runs them over a tile of hashed texels.
import { type WgslSource, wgslSource } from '../../../../math/src/wgsl/source.fixture.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { rejectShadingShader } from './rejectionWgsl.ts'
import { REJECT_SHADING_TILE } from './rejectionNetworkWgsl.ts'

/** The shading rejection's program, whose network (`minMax3x3`…) runs over a tile in workgroup
 *  memory, a column of texels to each lane. */
export const PROGRAM = wgslSource(rejectShadingShader('rgba8unorm', 'rgba16float'))
export const TILE = REJECT_SHADING_TILE
/** The texels of a lane's column: what the program declares (`Px`). */
const ROWS = Number(/alias Px=array<vec4f,(\d+)>;/.exec(PROGRAM)![1])

export type Texel = number[]
export type Column = Texel[]
type Operators = {
  minMax3x3: (v: Column) => { lo: Column; hi: Column }
  weightedSum3x3: (v: Column, h: number[], w: number[]) => Column
  totalVariation3x3: (v: Column) => Column
  median3x3: (v: Column) => Column
  anyThread: (x: boolean) => boolean
}

/** The value of texel (x, y) of the tile: four channels of a hash, each in [0, 1). */
export const texelAt = (x: number, y: number): Texel =>
  [0, 1, 2, 3].map(
    (k) => ((((x * 73856093) ^ (y * 19349663) ^ (k * 83492791)) >>> 0) % 1000) / 1000,
  )
export const wrapped = (i: number) => ((i % TILE) + TILE) % TILE

/** The lanes of the workgroup: the place of the first texel of each one's column. */
export const LANES = Array.from({ length: (TILE * TILE) / ROWS }, (_, lane) => ({
  x: lane % TILE,
  row: Math.floor(lane / TILE) * ROWS,
}))

/** The tile's texels row by row, texel (x, y) that of the hash at (x + `shiftX`, y + `shiftY`). */
export const tileOf = (shiftX = 0, shiftY = 0): Texel[] =>
  Array.from({ length: TILE * TILE }, (_, at) =>
    texelAt((at % TILE) + shiftX, Math.floor(at / TILE) + shiftY),
  )

/** The column of `tile` a lane at column `x`, first row `row`, holds. */
export const columnOf = (tile: Texel[], x: number, row: number): Column =>
  Array.from({ length: ROWS }, (_, r) => tile[(row + r) * TILE + x])

const OPERATORS = ['minMax3x3', 'weightedSum3x3', 'totalVariation3x3', 'median3x3', 'anyThread']

/** The operators `names` of `program` (the program of the 8-bit forms and the network's operators
 *  unless told) as the lane at column `x`, first row `row`, runs them over `network`, the tile's
 *  texels row by row; `scope` adds what the program names beyond the lane's. The barriers are
 *  no-ops: a run is one lane's, after the others' columns were shared, and the texels it shares
 *  are those already there. */
export const operatorsOf = <T = Operators>(
  network: Texel[],
  x: number,
  row: number,
  program: WgslSource = PROGRAM,
  names: string[] = OPERATORS,
  scope: object = {},
) =>
  shaderRun<T>(program, names, {
    network,
    laneX: x,
    laneRow: row,
    workgroupBarrier: () => {},
    workgroupUniformLoad: (pointer: { get(): Texel }) => pointer.get(),
    // The structures and the alias the text declares by name, all empty at the start.
    $zero: (type: string) =>
      type === 'Box'
        ? { lo: [], hi: [] }
        : type === 'Statistics'
          ? { box: { lo: [], hi: [] }, blurred: [], variation: [] }
          : [],
    ...scope,
  })

/** What `operator` gives each texel of the tile, every lane running it over its column. */
export function overTile<T>(operator: (operators: Operators, column: Column) => T[]) {
  const network = tileOf()
  const found: T[] = []
  for (const { x, row } of LANES) {
    operator(operatorsOf(network, x, row), columnOf(network, x, row)).forEach((value, r) => {
      found[(row + r) * TILE + x] = value
    })
  }
  return (x: number, y: number) => found[y * TILE + x]
}
