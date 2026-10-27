// The shading rejection's 16-bit program: a paired operator gives each of the two values of an
// exchange what the operator over it alone gives, and the memory it needs fits the workgroup.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslSource } from '../../../../math/src/wgsl/source.fixture.ts'
import { builtins } from '../../materials/texture/shaderRunBuiltins.fixture.ts'
import { rejectShadingShader } from './rejectionWgsl.ts'
import {
  type Column,
  columnOf,
  LANES,
  operatorsOf,
  tileOf,
  type Texel,
  TILE,
  wrapped,
} from './rejectionNetwork.fixture.ts'
import { GUARANTEED_WORKGROUP_BYTES } from '../../gpu/core/textureLimits.ts'

/** The paired operators of the 16-bit program, whose memory holds two values of an exchange. */
type Pairs = {
  minMaxPair: (
    a: Column,
    b: Column,
  ) => { first: { lo: Column; hi: Column }; second: { lo: Column; hi: Column } }
  statisticsAndVariation: (
    a: Column,
    b: Column,
  ) => {
    first: { box: { lo: Column; hi: Column }; blurred: Column; variation: Column }
    second: Column
  }
  blurAndMinMax: (a: Column, b: Column) => { first: Column; second: { lo: Column; hi: Column } }
  boxAndPlus3x3: (v: Column) => {
    box: { lo: Column; hi: Column }
    plus: { lo: Column; hi: Column }
  }
  statistics3x3: (v: Column) => {
    box: { lo: Column; hi: Column }
    blurred: Column
    variation: Column
  }
  blur3x3: (v: Column) => Column
  minMax3x3: (v: Column) => { lo: Column; hi: Column }
  totalVariation3x3: (v: Column) => Column
}
const PAIRS = [
  'minMaxPair',
  'statisticsAndVariation',
  'blurAndMinMax',
  'boxAndPlus3x3',
  'statistics3x3',
  'blur3x3',
  'minMax3x3',
  'totalVariation3x3',
]
const HALF_PROGRAM = wgslSource(rejectShadingShader('rgba8unorm', 'rgba16float', true))

test('a paired operator gives each value what the operator over it alone gives, bit for bit', () => {
  const first = tileOf()
  // Random-looking texels of a second value, in [-1, 1).
  const second = tileOf(17, 5).map((texel) => texel.map((v) => 2 * v - 1))
  const run = (network: Texel[], x: number, row: number) =>
    // The 16-bit vectors are computed in double precision here: the arithmetic text is what is compared.
    operatorsOf<Pairs>(network, x, row, HALF_PROGRAM, PAIRS, {
      vec3h: builtins.vec3f,
      vec4h: builtins.vec4f,
    })
  for (const { x, row } of LANES) {
    const a = columnOf(first, x, row)
    const b = columnOf(second, x, row)
    const both = run([...first, ...second], x, row)
    const alone = (tile: Texel[]) => run(tile, x, row)
    const where = `lane (${x}, ${row})`
    assert.deepEqual(
      both.minMaxPair(a, b),
      { first: alone(first).minMax3x3(a), second: alone(second).minMax3x3(b) },
      `${where} boxes`,
    )
    assert.deepEqual(
      both.statisticsAndVariation(a, b),
      { first: alone(first).statistics3x3(a), second: alone(second).totalVariation3x3(b) },
      `${where} statistics and variation`,
    )
    assert.deepEqual(
      both.blurAndMinMax(a, b),
      { first: alone(first).blur3x3(a), second: alone(second).minMax3x3(b) },
      `${where} blur and box`,
    )
    // One share, two operators: the box and the box over the texel and its four nearest.
    const around = alone(first).boxAndPlus3x3(a)
    assert.deepEqual(around.box, alone(first).minMax3x3(a), `${where} box beside its plus`)
    const cross = (r: number) =>
      [
        [0, 0],
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ].map(([dx, dy]) => first[wrapped(row + r + dy) * TILE + wrapped(x + dx)])
    around.plus.lo.forEach((lo, r) =>
      assert.deepEqual(
        lo,
        [0, 1, 2, 3].map((k) => Math.min(...cross(r).map((t) => t[k]))),
        `${where} plus lowest`,
      ),
    )
    around.plus.hi.forEach((hi, r) =>
      assert.deepEqual(
        hi,
        [0, 1, 2, 3].map((k) => Math.max(...cross(r).map((t) => t[k]))),
        `${where} plus highest`,
      ),
    )
  }
})

test('the memory of the network holds two values of an exchange only where it fits the guaranteed workgroup bytes', () => {
  const bytesOf = (program: string, size: number) => size * (program.includes('vec4h') ? 8 : 16)
  for (const [program, pairs] of [
    [wgslSource(rejectShadingShader('rgba8unorm', 'rgba16float', true)), true],
    [wgslSource(rejectShadingShader('rgba8unorm', 'rgba16float')), false],
    [
      wgslSource(
        rejectShadingShader('rgba8unorm', 'rgba16float', true, 'buffer', 'buffer', {
          lanes: TILE,
          pinned: false,
        }),
      ),
      true,
    ],
    [
      wgslSource(
        rejectShadingShader('rgba8unorm', 'rgba16float', false, 'buffer', 'buffer', {
          lanes: TILE,
          pinned: false,
        }),
      ),
      false,
    ],
  ] as const) {
    const size = Number(/var<workgroup> network:array<vec4[hf],(\d+)>;/.exec(program)![1])
    assert.ok(bytesOf(program, size) <= GUARANTEED_WORKGROUP_BYTES, `${size} cells fit`)
    assert.equal(/fn share2\(/.test(program), pairs)
  }
})
