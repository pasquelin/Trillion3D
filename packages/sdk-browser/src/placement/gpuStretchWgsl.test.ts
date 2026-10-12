// The stretch the GPU derives for a composed root (`gpuStretchWgsl.ts`) is the CPU's `maxStretch`
// of its single-precision world words, as `refreshStretchAt` stores it in a `Float32Array`: word
// for word, on generated worlds — rotations, uneven and negative scales, shears, a cut-down
// matrix, a sphere's scale, the exact cases (an identity, a pure turn, a pure scale) that take
// each branch of the formula.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { random } from '../page/cut/cutRuleChecks.fixture.ts'
import { maxStretch } from '../../../sdk-core/src/index.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { STRETCH_WGSL } from './gpuStretchWgsl.ts'
import { DOUBLE_HELPERS, countLeadingZeros, generated } from './composeDoubles.fixture.ts'

const run = shaderRun<{ maxStretchBits(w: number[]): number }>(
  wgslProgram('', [STRETCH_WGSL]),
  [
    ...DOUBLE_HELPERS,
    ...['dDiv', 'dLess', 'dRsqrt', 'dSqrt', 'toF32', 'fromF32', 'chebyshevRoot'],
    'maxStretchBits',
  ],
  { countLeadingZeros },
)

const bitsOf = (x: number) => new Uint32Array(new Float32Array([x]).buffer)[0]
/** The words of a world's single-precision row, and what the CPU stores for its stretch. */
const words = (world: ArrayLike<number>) => [...new Uint32Array(Float32Array.from(world).buffer)]
const expected = (world: ArrayLike<number>) =>
  bitsOf(maxStretch(Array.from(Float32Array.from(world))))

test('the stretch of a generated world is the CPU’s, word for word', () => {
  const next = random(23)
  for (let i = 0; i < 1500; i++) {
    const world = generated(next, [10, 1e4][i % 2])
    const bits = run.maxStretchBits(words(world)) >>> 0
    assert.equal(bits, expected(world), `case ${i}: ${Array.from(world)}`)
  }
})

test('the exact cases take the branches of the formula: pure scales, turns, the identity, nothing', () => {
  const matrix = (a: number[]) => [
    a[0],
    a[1],
    a[2],
    0,
    a[3],
    a[4],
    a[5],
    0,
    a[6],
    a[7],
    a[8],
    0,
    0,
    0,
    0,
    1,
  ]
  const cases: number[][] = [
    matrix([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    matrix([3, 0, 0, 0, 3, 0, 0, 0, 3]),
    matrix([3, 0, 0, 0, 0.5, 0, 0, 0, 1.25]),
    matrix([-2, 0, 0, 0, 1, 0, 0, 0, 1]),
    matrix([0, 0, 0, 0, 0, 0, 0, 0, 0]),
    matrix([0, 1, 0, -1, 0, 0, 0, 0, 1]),
    matrix([Math.SQRT1_2, Math.SQRT1_2, 0, -Math.SQRT1_2, Math.SQRT1_2, 0, 0, 0, 1]),
    matrix([1, 0, 0, 1e-3, 1, 0, 0, 0, 1]),
    matrix([1, 1, 0, 1, 1, 0, 0, 0, 1]),
    matrix([1, 1, 1, 1, 1, 1, 1, 1, 1]),
    matrix([2, 0, 0, 0, 2, 0, 0, 0, 1e-20]),
    matrix([1e20, 0, 0, 0, 1e10, 0, 0, 0, 1]),
  ]
  for (const [i, world] of cases.entries())
    assert.equal(run.maxStretchBits(words(world)) >>> 0, expected(world), `case ${i}`)
})

test('a word that is no finite number leaves the stretch as it was: the CPU refuses the matrix', () => {
  const world = generated(random(3), 10),
    row = words(world)
  row[5] = 0x7f800000
  assert.equal(run.maxStretchBits(row) >>> 0, 0xffffffff)
  row[5] = 0x7fc00000
  assert.equal(run.maxStretchBits(row) >>> 0, 0xffffffff)
})
