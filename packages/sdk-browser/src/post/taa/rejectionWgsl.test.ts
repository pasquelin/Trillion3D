// The shading rejection's program: what its texels' words say, its network of operators over the
// 3×3 and the luma byte it writes, run in JavaScript from the shipped text.
import test from 'node:test'
import assert from 'node:assert/strict'
import { near } from '../../../../math/src/float/near.fixture.ts'
import { wgslSource } from '../../../../math/src/wgsl/source.fixture.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { REPROJECT_BITS, reprojectShader } from './reprojectWgsl.ts'
import { rejectShadingShader } from './rejectionWgsl.ts'
import { REJECT_SHADING_TILE } from './rejectionNetworkWgsl.ts'
import { spatialAntiAliasingShader } from './spatialAntiAliasingWgsl.ts'

test('a texel whose material asks a restart is restarted as a disoccluded one is, and a pixel animation alone is not', () => {
  const { isRestarted, asksRestart } = shaderRun<{
    isRestarted: (word: number) => boolean
    asksRestart: (word: number) => boolean
  }>(rejectShadingShader('rgba8unorm', 'rgba16float'), ['isRestarted', 'asksRestart'], {})
  const { offScreen, disoccluded, restarts, animated, filled } = REPROJECT_BITS
  assert.deepEqual([offScreen, disoccluded, restarts].map(isRestarted), [true, true, true])
  assert.deepEqual([0, animated, filled].map(isRestarted), [false, false, false])
  assert.deepEqual([restarts, disoccluded, animated | restarts].map(asksRestart), [
    true,
    false,
    true,
  ])
  // Only an image that can resurrect a pixel sets the bit from the marks, and the shading rejection
  // (which decides the frame a pixel keeps since the merge was folded into it) never resurrects a
  // texel that asks it.
  assert.match(
    wgslSource(reprojectShader('rgba8unorm')),
    /select\(0u,16u,\(mark\.a&16u\)!=0u&&view\.resurrection\.x!=0\.0\)/,
  )
  assert.match(
    wgslSource(rejectShadingShader('rgba8unorm', 'rgba16float')),
    /closer\[r\]=count\[r\]\.x>[^;]*&&!asksRestart\(word\[r\]\);/,
  )
})

/** The shading rejection's program, whose network (`minMax3x3`…) runs over a tile in workgroup
 *  memory, a column of texels to each lane. */
const PROGRAM = wgslSource(rejectShadingShader('rgba8unorm', 'rgba16float'))
const TILE = REJECT_SHADING_TILE
/** The texels of a lane's column: what the program declares (`Px`). */
const ROWS = Number(/alias Px=array<vec4f,(\d+)>;/.exec(PROGRAM)![1])

type Texel = number[]
type Column = Texel[]
type Operators = {
  minMax3x3: (v: Column) => { lo: Column; hi: Column }
  weightedSum3x3: (v: Column, h: number[], w: number[]) => Column
  totalVariation3x3: (v: Column) => Column
  median3x3: (v: Column) => Column
  anyThread: (x: boolean) => boolean
}

/** The value of texel (x, y) of the tile: four channels of a hash, each in [0, 1). */
const texelAt = (x: number, y: number): Texel =>
  [0, 1, 2, 3].map(
    (k) => ((((x * 73856093) ^ (y * 19349663) ^ (k * 83492791)) >>> 0) % 1000) / 1000,
  )
const wrapped = (i: number) => ((i % TILE) + TILE) % TILE

/** The lanes of the workgroup: the place of the first texel of each one's column. */
const LANES = Array.from({ length: (TILE * TILE) / ROWS }, (_, lane) => ({
  x: lane % TILE,
  row: Math.floor(lane / TILE) * ROWS,
}))

/** The network's operators as the lane at column `x`, first row `row`, runs them over `network`, the
 *  tile's texels row by row. The barriers are no-ops: a run is one lane's, after the others'
 *  columns were shared, and the texels it shares are those already there. */
const operatorsOf = (network: Texel[], x: number, row: number) =>
  shaderRun<Operators>(
    PROGRAM,
    ['minMax3x3', 'weightedSum3x3', 'totalVariation3x3', 'median3x3', 'anyThread'],
    {
      network,
      laneX: x,
      laneRow: row,
      workgroupBarrier: () => {},
      workgroupUniformLoad: (pointer: { get(): Texel }) => pointer.get(),
      // The structure and the alias the text declares by name, both empty at the start.
      $zero: (type: string) => (type === 'Box' ? { lo: [], hi: [] } : []),
    },
  )

/** What `operator` gives each texel of the tile, every lane running it over its column. */
function overTile<T>(operator: (operators: Operators, column: Column) => T[]) {
  const network = Array.from({ length: TILE * TILE }, (_, at) =>
    texelAt(at % TILE, Math.floor(at / TILE)),
  )
  const found: T[] = []
  for (const { x, row } of LANES) {
    const column = Array.from({ length: ROWS }, (_, r) => network[(row + r) * TILE + x])
    operator(operatorsOf(network, x, row), column).forEach((value, r) => {
      found[(row + r) * TILE + x] = value
    })
  }
  return (x: number, y: number) => found[y * TILE + x]
}

test('the network gives each texel the operators of its 3×3, the neighbourhood wrapping around at the tile’s edge', () => {
  const h = [1, 2, 3],
    w = [5, 7, 11]
  const box = overTile((operators, column) => {
    const { lo, hi } = operators.minMax3x3(column)
    return column.map((_, r) => ({ lo: lo[r], hi: hi[r] }))
  })
  const sum = overTile((operators, column) => operators.weightedSum3x3(column, h, w))
  const variation = overTile((operators, column) => operators.totalVariation3x3(column))
  const median = overTile((operators, column) => operators.median3x3(column))
  const channels = [0, 1, 2, 3]
  /** Texel (x, y) against the 3×3 computed directly, its neighbours past the edge wrapped or not. */
  const check = (x: number, y: number, wrap: boolean) => {
    const at = `(${x}, ${y})`
    const around = [-1, 0, 1].flatMap((dy) =>
      [-1, 0, 1].map((dx) => ({
        dx,
        dy,
        texel: wrap ? texelAt(wrapped(x + dx), wrapped(y + dy)) : texelAt(x + dx, y + dy),
      })),
    )
    const values = (k: number) => around.map(({ texel }) => texel[k])
    near(
      box(x, y).lo,
      channels.map((k) => Math.min(...values(k))),
      `${at} lowest`,
      1e-12,
    )
    near(
      box(x, y).hi,
      channels.map((k) => Math.max(...values(k))),
      `${at} highest`,
      1e-12,
    )
    // The row weights `h` across, the column weights `w` down: a swapped tap row would show.
    near(
      sum(x, y),
      channels.map((k) =>
        around.reduce((total, { dx, dy, texel }) => total + h[dx + 1] * w[dy + 1] * texel[k], 0),
      ),
      `${at} weighted sum`,
    )
    near(
      variation(x, y),
      channels.map((k) => 1.125 * texelAt(x, y)[k] - 0.125 * values(k).reduce((a, b) => a + b, 0)),
      `${at} total variation`,
    )
    near(
      median(x, y),
      channels.map((k) => values(k).sort((a, b) => a - b)[4]),
      `${at} median`,
      1e-12,
    )
  }
  // The inner square, the tile less the three texels each side the workgroup only reads, has all of
  // its 3×3 inside the tile...
  for (let y = 3; y < TILE - 3; y++) for (let x = 3; x < TILE - 3; x++) check(x, y, false)
  // ...and one operator deep the whole tile is exact, the edge's neighbours those of the other side.
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) check(x, y, true)
})

test('a vote of the workgroup is true for every lane when any lane holds it, and false again when none does', () => {
  const network = Array.from({ length: TILE * TILE }, () => [0, 0, 0, 0])
  /** The vote after the lane at `holder` holds `x` and no other does: the lanes run in turn, the one
   *  at the tile's origin first, which clears the vote; then a lane that holds nothing reads it. */
  const vote = (holder: number | undefined) => {
    LANES.forEach(({ x, row }, lane) => operatorsOf(network, x, row).anyThread(lane === holder))
    return operatorsOf(network, 1, 0).anyThread(false)
  }
  assert.equal(vote(undefined), false, 'no lane holds it')
  assert.equal(vote(LANES.length - 1), true, 'the last lane does')
  assert.equal(vote(0), true, 'the lane that clears the vote does')
  assert.equal(vote(undefined), false, 'the vote of the image before is cleared')
})

test('the LDR luma a texel writes is the byte the anti-aliaser reads, the other bytes of its word kept', () => {
  // The write is a block of the rejection's entry, run as a function of its own.
  const write = /if\(view\.quality\.y>0\.0\)\{([^}]*)\}/.exec(PROGRAM)?.[1]
  assert.ok(write, 'the rejection writes the luma where the level runs the anti-aliaser')
  const words = [0, 0, 0]
  // `pack4x8unorm` as the specification has it: four unit floats rounded to bytes, the first low.
  const pack4x8unorm = (v: number[]) =>
    v.reduce(
      (word, x, i) => (word | (Math.round(Math.min(Math.max(x, 0), 1) * 255) << (8 * i))) >>> 0,
      0,
    )
  const { writeLuma } = shaderRun<{ writeLuma: (at: number, scene: number[]) => void }>(
    `${PROGRAM}\nfn writeLuma(at:u32,scene:vec3f){${write}}`,
    ['writeLuma'],
    { lumaOut: words, pack4x8unorm },
  )
  const { lumaAt } = shaderRun<{ lumaAt: (at: number) => number }>(
    spatialAntiAliasingShader(),
    ['lumaAt'],
    { luma: words },
  )
  const scenes = [
    [0.2, 0.3, 0.1],
    [1, 1, 1],
    [0, 0, 0],
    [4, 2, 0.5],
    [0.5, 0.25, 0.75],
    [10, 0, 0],
    [0.01, 0.02, 0.03],
    [3, 3, 3],
  ]
  // Eight texels, two words, written in an order that mixes them, then one written again.
  for (const at of [3, 0, 2, 1, 7, 4, 6, 5]) writeLuma(at, scenes[at])
  scenes[2] = [0.6, 0.6, 0.6]
  writeLuma(2, scenes[2])
  scenes.forEach((scene, at) => {
    // The Rec. 601 luma, in the display's range `l / (0.5 + l)`, as a byte.
    const luma = 0.299 * scene[0] + 0.587 * scene[1] + 0.114 * scene[2]
    assert.equal(lumaAt(at), Math.round(255 * (luma / (0.5 + luma))) / 255, `texel ${at}`)
  })
  assert.equal(lumaAt(8), 0, 'the next word is untouched')
})
