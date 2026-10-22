// The GPU's finiteness test and JavaScript-ordered extrema of a double, run in JavaScript from the
// shipped text (`shaderRun`), against `Math` bit for bit.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from './shaderRun.fixture.ts'
import { dIsFinite } from '../../../../math/src/wgsl/doubleRound.ts'
import { dMathMax, dMathMin } from '../../../../math/src/wgsl/doubleOrder.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'

type Pair = number[]
type Run = {
  dIsFinite(a: Pair): boolean
  dMathMin(a: Pair, b: Pair): Pair
  dMathMax(a: Pair, b: Pair): Pair
}
const NAMES = ['dIsFinite', 'dMathMin', 'dMathMax']
const run = shaderRun<Run>(wgslModule(dIsFinite, dMathMin, dMathMax), NAMES, {})

const cell = new Float64Array(1),
  bits = new Uint32Array(cell.buffer)
const toPair = (x: number): Pair => ((cell[0] = x), [bits[1], bits[0]])
const fromPair = ([high, low]: Pair) => ((bits[1] = high >>> 0), (bits[0] = low >>> 0), cell[0])
/** A NaN as the one all-ones pattern the GPU gives. */
const expected = (x: number): Pair => (x !== x ? [0xffffffff, 0xffffffff] : toPair(x))
const words = (pair: Pair) => pair.map((word) => word >>> 0)

const EDGES = [
  0,
  -0,
  5e-324,
  -5e-324,
  2.2250738585072014e-308,
  0.5,
  -0.5,
  0.49999999999999994,
  -0.49999999999999994,
  1,
  -1,
  1.5,
  -1.5,
  2 ** 31 - 0.5,
  2 ** 32 - 1,
  2 ** 52 - 0.5,
  -(2 ** 52) + 0.5,
  2 ** 52,
  2 ** 52 + 1,
  2 ** 52 - 1,
  -(2 ** 52) - 1,
  2 ** 53 + 2,
  1.7976931348623157e308,
  -1.7976931348623157e308,
  Infinity,
  -Infinity,
  NaN,
]

/** Random doubles over every exponent, and fractions near the unit. */
function values(seed: number, count: number) {
  const next = lcgRandom(seed)
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    const roll = next()
    if (roll < 0.3) {
      bits[1] = Math.floor(next() * 2 ** 32)
      bits[0] = Math.floor(next() * 2 ** 32)
      out.push(cell[0])
    } else if (roll < 0.7) out.push((next() - 0.5) * 2 ** Math.floor(next() * 60 - 4))
    else out.push(Math.round((next() - 0.5) * 4000) / 8)
  }
  return out
}

test('finiteness is Number.isFinite’s, infinities and NaN included', () => {
  for (const x of [...EDGES, ...values(11, 4000)])
    assert.equal(run.dIsFinite(expected(x)), Number.isFinite(x), `isFinite(${x})`)
})

test('extrema read NaN as JavaScript does', () => {
  const pool = [...EDGES, ...values(13, 200)]
  const next = lcgRandom(14)
  for (let i = 0; i < 8000; i++) {
    const a = pool[Math.floor(next() * pool.length)],
      b = pool[Math.floor(next() * pool.length)]
    const [pa, pb] = [expected(a), expected(b)]
    assert.deepEqual(words(run.dMathMin(pa, pb)), expected(Math.min(a, b)), `min(${a}, ${b})`)
    assert.deepEqual(words(run.dMathMax(pa, pb)), expected(Math.max(a, b)), `max(${a}, ${b})`)
  }
  assert.ok(Object.is(fromPair(run.dMathMin(toPair(0), toPair(-0))), -0))
})
