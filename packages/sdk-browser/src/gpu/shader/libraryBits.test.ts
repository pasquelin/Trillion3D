// The bit-set, byte and float-class declarations of the maths library
// (`packages/math/src/wgsl/integer.ts`, `color.ts`), their shipped text run in JavaScript with the
// GPU's unsigned arithmetic, against BigInt words and the floats a typed array reads from the bits.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import {
  bitAt,
  bitIsSet,
  bitMask,
  bitWord,
  byteOf,
  isFiniteWord,
  isNanWord,
} from '../../../../math/src/wgsl/integer.ts'
import { unorm8 } from '../../../../math/src/wgsl/color.ts'
import { isFiniteScale } from '../../../../math/src/wgsl/inverseTranspose.ts'

type U = (...args: number[]) => number
type B = (...args: number[]) => boolean
const run = shaderRun<{
  bitWord: U
  bitMask: U
  bitAt: U
  bitIsSet: B
  byteOf: U
  unorm8: U
  isNanWord: B
  isFiniteWord: B
  isFiniteScale: (t: number) => boolean
}>(
  wgslModule(
    bitWord,
    bitMask,
    bitAt,
    bitIsSet,
    byteOf,
    unorm8,
    isNanWord,
    isFiniteWord,
    isFiniteScale,
  ),
  [
    'bitWord',
    'bitMask',
    'bitAt',
    'bitIsSet',
    'byteOf',
    'unorm8',
    'isNanWord',
    'isFiniteWord',
    'isFiniteScale',
  ],
  {},
)

const WORDS = [0, 1, 0x80000000, 0xffffffff, 0x12345678, 0xdeadbeef, 0x00ff00ff, 0xa5a5a5a5]

test('a bit set: bit i in word i/32 at mask 2^(i mod 32), read set or not', () => {
  for (const i of [0, 1, 5, 31, 32, 33, 63, 64, 1000, 2 ** 31, 2 ** 32 - 1]) {
    assert.equal(run.bitWord(i), Math.floor(i / 32), `word ${i}`)
    assert.equal(run.bitMask(i), Number(1n << BigInt(i % 32)), `mask ${i}`)
  }
  for (const word of WORDS)
    for (let i = 0; i < 64; i++) {
      const bit = Number((BigInt(word) >> BigInt(i % 32)) & 1n)
      assert.equal(run.bitAt(word, i), bit, `${word} ${i}`)
      assert.equal(run.bitIsSet(word, i), bit === 1, `${word} ${i}`)
      // The sites' second spelling, the word against the mask.
      assert.equal((word & run.bitMask(i)) >>> 0 !== 0, bit === 1)
    }
})

test('byte k of a word, the lowest first, and its unit value over 255', () => {
  for (const word of WORDS)
    for (let k = 0; k < 4; k++) {
      const byte = Number((BigInt(word) >> BigInt(8 * k)) & 255n)
      assert.equal(run.byteOf(word, k), byte, `${word} ${k}`)
      assert.equal(run.unorm8(word, k), byte / 255, `${word} ${k}`)
    }
  // The top byte needs no mask: the sites' `w>>24u` is the same word.
  for (const word of WORDS) assert.equal(run.byteOf(word, 3), word >>> 24)
  assert.equal(run.unorm8(0xff000000, 3), 1)
  assert.equal(run.unorm8(0x00000080, 0), 128 / 255)
})

/** The 32 bits of the float32 nearest `x`. */
const bitsOf = (x: number) => new Uint32Array(new Float32Array([x]).buffer)[0]
/** The float32 of the bits `word`. */
const floatOf = (word: number) => new Float32Array(new Uint32Array([word]).buffer)[0]

test('a float classed by its bits: NaN past the infinity, finite under the full exponent', () => {
  const floats = [
    0,
    -0,
    1,
    -1,
    2 ** -149,
    -(2 ** -126),
    3.4e38,
    -3.4028234663852886e38,
    Infinity,
    -Infinity,
    NaN,
  ]
  const words = [...floats.map(bitsOf), 0x7f800001, 0xff800001, 0x7fffffff, 0xffc00000, 0x7f7fffff]
  for (const word of words) {
    const x = floatOf(word)
    assert.equal(run.isNanWord(word), Number.isNaN(x), word.toString(16))
    assert.equal(run.isFiniteWord(word), Number.isFinite(x), word.toString(16))
  }
})

test('isFiniteScale, the same exponent test as isFiniteWord: above zero and finite', () => {
  for (const t of [1, 2 ** -149, 3.4e38, 0, -0, -1, Infinity, NaN])
    assert.equal(run.isFiniteScale(t), t > 0 && Number.isFinite(t), String(t))
})
