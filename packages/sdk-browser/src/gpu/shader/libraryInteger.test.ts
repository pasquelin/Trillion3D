// The integer declarations of the maths library (`packages/math/src/wgsl/integer.ts`), their
// shipped text run in JavaScript with the GPU's unsigned arithmetic — wrapped modulo 2³², a
// quotient truncated —, against the processor's twins and an independent count of bits.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { builtins } from '../../texture/shaderRunBuiltins.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import {
  bitLength,
  ceilDiv,
  floorLog2,
  pow2FromExponent,
} from '../../../../math/src/wgsl/integer.ts'
import {
  ceilDiv as ceilDivTs,
  floorLog2 as floorLog2Ts,
} from '../../../../math/src/scalar/integers.ts'

type U = (x: number, n?: number) => number

/** `u32` operators: a sum, a difference or a product wrapped, a quotient truncated. */
const U32_SCOPE = {
  $b: (op: string, a: number, b: number) =>
    op === '/'
      ? Math.trunc(a / b)
      : op === '*'
        ? Math.imul(a, b) >>> 0
        : op === '+' || op === '-'
          ? (builtins.$b(op, a, b) as number) >>> 0
          : builtins.$b(op, a, b),
  countLeadingZeros: (x: number) => Math.clz32(x),
}

const WORDS = [
  0,
  1,
  2,
  3,
  31,
  32,
  33,
  63,
  64,
  65,
  1000,
  2 ** 16 + 1,
  2 ** 31 - 1,
  2 ** 31,
  2 ** 32 - 1,
]

test('ceilDiv is the processor ceilDiv on every count that does not wrap', () => {
  const run = shaderRun<{ ceilDiv: U }>(ceilDiv, ['ceilDiv'], U32_SCOPE).ceilDiv
  for (const a of WORDS.filter((a) => a < 2 ** 31))
    for (const n of [1, 2, 3, 4, 32, 64, 255, 1000])
      assert.equal(run(a, n), ceilDivTs(a, n), `${a}/${n}`)
  // Past 2³² − n the sum wraps, as every site's did.
  assert.equal(run(2 ** 32 - 1, 64), 0)
})

test('bitLength counts the bits that hold the word; floorLog2 is one less, -1 as a word at 0', () => {
  const ran = shaderRun<{ bitLength: U; floorLog2: U }>(
    wgslModule(bitLength, floorLog2),
    ['bitLength', 'floorLog2'],
    U32_SCOPE,
  )
  for (const x of WORDS) {
    const bits = x === 0 ? 0 : x.toString(2).length
    assert.equal(ran.bitLength(x), bits, `bitLength ${x}`)
    assert.equal(ran.floorLog2(x), (bits - 1) >>> 0, `floorLog2 ${x}`)
    assert.equal(ran.floorLog2(x), floorLog2Ts(x) >>> 0, `twin ${x}`)
  }
})

test('pow2FromExponent is 2^e exactly over the normal exponents', () => {
  const run = shaderRun<{ pow2FromExponent: U }>(
    pow2FromExponent,
    ['pow2FromExponent'],
    {},
  ).pow2FromExponent
  for (let e = -126; e <= 127; e++) assert.equal(run(e), 2 ** e, String(e))
})
