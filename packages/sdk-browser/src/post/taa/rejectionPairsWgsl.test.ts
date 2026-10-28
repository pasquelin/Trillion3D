// The shading rejection's 16-bit program: a paired operator gives each of the two values of an
// exchange what the operator over it alone gives, and the memory it needs fits the workgroup.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslSource } from '../../../../math/src/wgsl/source.fixture.ts'
import { builtins } from '../../materials/texture/shaderRunBuiltins.fixture.ts'
import { rejectShadingShader } from './rejectionWgsl.ts'
import { type Channels, NETWORK_WIDTHS, widthSuffix } from './rejectionNetworkWgsl.ts'
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

/** An operator of a width: the names of the network's operators end in the width's suffix. */
type Operator<T> = (...values: Column[]) => T
type Box = { lo: Column; hi: Column }
/** The names of the operators at the width `n`: they end in the width's suffix. */
const names = (n: Channels) => {
  const w = widthSuffix(n)
  return {
    minMaxPair: `minMaxPair${w}`,
    statisticsAndVariation: `statisticsAndVariation${w}`,
    blurAndMinMax: `blurAndMinMax${w}`,
    boxAndPlus3x3: `boxAndPlus3x3${w}`,
    statistics3x3: `statistics3x3${w}`,
    blur3x3: `blur3x3${w}`,
    minMax3x3: `minMax3x3${w}`,
    totalVariation3x3: `totalVariation3x3${w}`,
    median3x3: `median3x3${w}`,
    weightedSum3x3: `weightedSum3x3${w}`,
    sum3x3: `sum3x3${w}`,
  }
}
const HALF_PROGRAM = wgslSource(rejectShadingShader('rgba8unorm', 'rgba16float', true))

/** The channels of the first `n` of a column's texels. */
const narrow = (column: Column, n: Channels): Column => column.map((texel) => texel.slice(0, n))

/** The program's operators of width `n` as the lane at `x`, `row` runs them over `network`. */
const run = (network: Texel[], x: number, row: number, n: Channels) => {
  const program = HALF_PROGRAM
  const w = names(n)
  const found = operatorsOf<Record<string, Operator<unknown>>>(
    network,
    x,
    row,
    program,
    Object.values(w).filter((name) => program.includes(`fn ${name}(`)),
    // The 16-bit vectors are computed in double precision here: the arithmetic text is what is compared.
    { vec2h: builtins.vec2f, vec3h: builtins.vec3f, vec4h: builtins.vec4f },
  )
  return Object.fromEntries(Object.entries(w).map(([key, name]) => [key, found[name]])) as {
    [K in keyof typeof w]: Operator<any>
  }
}

test('a paired operator gives each value what the operator over it alone gives, bit for bit, at the width it is made for', () => {
  const first = tileOf()
  // Random-looking texels of a second value, in [-1, 1).
  const second = tileOf(17, 5).map((texel) => texel.map((v) => 2 * v - 1))
  const n = NETWORK_WIDTHS.pairs[0]
  for (const { x, row } of LANES) {
    const a = narrow(columnOf(first, x, row), n)
    const b = narrow(columnOf(second, x, row), n)
    const both = run([...first, ...second], x, row, n)
    const alone = (tile: Texel[]) => run(tile, x, row, n)
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
  }
})

test('the box beside its plus, from one share, is the box and the box over the texel and its four nearest', () => {
  const first = tileOf()
  const n = NETWORK_WIDTHS.boxAndPlus[0]
  for (const { x, row } of LANES) {
    const a = narrow(columnOf(first, x, row), n)
    const alone = run(first, x, row, n)
    const around = alone.boxAndPlus3x3(a) as { box: Box; plus: Box }
    const where = `lane (${x}, ${row})`
    assert.deepEqual(around.box, alone.minMax3x3(a), `${where} box beside its plus`)
    const cross = (r: number) =>
      [
        [0, 0],
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ].map(([dx, dy]) => first[wrapped(row + r + dy) * TILE + wrapped(x + dx)])
    const channels = Array.from({ length: n }, (_, k) => k)
    around.plus.lo.forEach((lo, r) =>
      assert.deepEqual(
        lo,
        channels.map((k) => Math.min(...cross(r).map((t) => t[k]))),
        `${where} plus lowest`,
      ),
    )
    around.plus.hi.forEach((hi, r) =>
      assert.deepEqual(
        hi,
        channels.map((k) => Math.max(...cross(r).map((t) => t[k]))),
        `${where} plus highest`,
      ),
    )
  }
})

// A value of fewer channels is worked on by the same operations in the same order as a value of four
// whose other channels it leaves out: a channel nobody reads is not worked on, and the ones that are
// give the same bits.
test('an operator of a narrower width gives the first channels of the four-channel operator, bit for bit', () => {
  const tile = tileOf(3, 11).map((texel) => texel.map((v) => 2 * v - 1))
  let compared = 0
  for (const operator of [
    'minMax3x3',
    'blur3x3',
    'totalVariation3x3',
    'median3x3',
    'sum3x3',
  ] as const) {
    for (const n of [3, 2, 1] as const) {
      if (!HALF_PROGRAM.includes(`fn ${names(n)[operator]}(`)) continue
      if (!HALF_PROGRAM.includes(`fn ${names(4)[operator]}(`)) continue
      for (const { x, row } of LANES.filter((_, k) => k % 7 === 0)) {
        const full = run(tile, x, row, 4)
        const part = run(tile, x, row, n)
        const column = columnOf(tile, x, row)
        const wide = full[operator](column)
        const narrowed = part[operator](narrow(column, n))
        const first = (value: unknown): unknown =>
          Array.isArray(value)
            ? value.map((v) => (Array.isArray(v) ? v.slice(0, n) : v))
            : Object.fromEntries(Object.entries(value as object).map(([k, v]) => [k, first(v)]))
        assert.deepEqual(narrowed, first(wide), `${operator} at ${n} channels, lane (${x}, ${row})`)
        compared++
      }
    }
  }
  // minMax, blur, total variation and sum at three, two and one channels (twelve), the median at two.
  assert.equal(compared, 13 * Math.ceil(LANES.length / 7))
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

test('every operator of the network a program names is declared, in all four programs: 16 and 32 bits, in workgroup memory or as subgroups', () => {
  for (const half of [false, true])
    for (const wave of [undefined, { lanes: TILE, pinned: false } as const]) {
      const program = wgslSource(
        rejectShadingShader('rgba8unorm', 'rgba16float', half, 'buffer', 'buffer', wave),
      )
      const declared = new Set(
        [...program.matchAll(/\b(?:fn|struct) (\w+)[({]/g)].map((found) => found[1]),
      )
      const used = new Set(
        [
          ...program.matchAll(
            /\b((?:minMax|min|max|blur|sum|totalVariation|median|weightedSum|statistics|boxAndPlus|heldIn|annihilateToGuide|share2?|minMaxPair|blurAndMinMax|statisticsAndVariation)\w*)\(/g,
          ),
        ].map((found) => found[1]),
      )
      for (const name of used)
        assert.ok(
          declared.has(name) || ['min', 'max', 'abs'].includes(name),
          `${name} is used and not declared (${half ? '16' : '32'} bits${wave ? ', subgroups' : ''})`,
        )
    }
})
