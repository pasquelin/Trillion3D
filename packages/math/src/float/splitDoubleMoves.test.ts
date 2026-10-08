// `ceilFloat32` and `floorFloat32` start from `Math.fround`: on every float32 exponent, both signs,
// the floats, their double neighbours and the ties between floats, the zeros, the largest float and
// past it, NaN and the subnormals of both formats, each keeps the bits of its before-form
// (`splitDoubleBefore.fixture.ts`).
import assert from 'node:assert/strict'
import test from 'node:test'
import { ceilFloat32, floorFloat32 } from './splitDouble.ts'
import { ceilFloat32Before, floorFloat32Before } from './splitDoubleBefore.fixture.ts'
import { FLOAT32_MAX } from '../constants.ts'
import { HOSTILE_VALUES } from '../sequence/moves.fixture.ts'
import { halton } from '../sequence/halton.ts'

const double = new Float64Array(1),
  word = new BigUint64Array(double.buffer)

/** The double one ulp from `value` in the direction of its magnitude's `step` (+1 or −1): its bits
 *  moved by one, so a zero steps to the smallest subnormal and the largest finite to infinity. */
function doubleStep(value: number, step: 1 | -1) {
  double[0] = value
  if (value === 0) return step > 0 ? 2 ** -1074 * Math.sign(1 / value) : value
  word[0] += step > 0 ? 1n : -1n
  return double[0]
}

/** `value` and its double neighbours on both sides. */
const withNeighbours = (value: number) => [
  value,
  doubleStep(value, 1),
  doubleStep(value, -1),
  doubleStep(doubleStep(value, 1), 1),
]

/** The inputs: per float32 exponent (subnormal −149 to past the top, 128) and sign, eight floats of
 *  the binade, each with the tie halfway to the next float, all with their double neighbours; then
 *  the edges of both formats. */
function inputs() {
  const values: number[] = []
  for (let e = -150; e <= 128; e++)
    for (const sign of [1, -1])
      for (let j = 0; j < 8; j++) {
        const float = Math.fround(sign * (1 + (j ? halton(j + e + 200, 2) : 0)) * 2 ** e)
        const ulp = 2 ** Math.max(Math.floor(Math.log2(Math.abs(float) || 1)) - 23, -149)
        values.push(...withNeighbours(float), ...withNeighbours(float + (sign * ulp) / 2))
      }
  for (const edge of [
    0,
    -0,
    FLOAT32_MAX,
    -FLOAT32_MAX,
    FLOAT32_MAX + 2 ** 103,
    -(FLOAT32_MAX + 2 ** 103),
    2 ** 128,
    -(2 ** 128),
    2 ** -149,
    -(2 ** -149),
    2 ** -150,
    -(2 ** -150),
    3 * 2 ** -151,
    2 ** -126,
    2 ** -1074,
    -(2 ** -1074),
    2 ** -1022,
    Number.MAX_VALUE,
    -Number.MAX_VALUE,
    ...HOSTILE_VALUES,
  ])
    values.push(...withNeighbours(edge))
  values.push(NaN, Infinity, -Infinity)
  return values
}

test('ceilFloat32, floorFloat32: Math.fround first keeps every bit', () => {
  const values = inputs()
  assert.ok(values.length > 30000, `${values.length} inputs`)
  for (const value of values) {
    const ceil = ceilFloat32Before(value),
      floor = floorFloat32Before(value)
    if (!Object.is(ceilFloat32(value), ceil)) assert.fail(`ceil ${value}: old ${ceil}`)
    if (!Object.is(floorFloat32(value), floor)) assert.fail(`floor ${value}: old ${floor}`)
  }
})
