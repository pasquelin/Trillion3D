import test from 'node:test'
import assert from 'node:assert/strict'
import { lcgRandom } from '../sequence/random.ts'
import { FLOAT32_MIN_NORMAL } from '../constants.ts'
import { f32Bits, fromF32Bits } from './bits.ts'

test('a float32 reads as the bits IEEE 754 gives it, sign and zero kept', () => {
  assert.equal(f32Bits(1), 0x3f800000)
  assert.equal(f32Bits(-2), 0xc0000000)
  assert.equal(f32Bits(0), 0)
  assert.equal(f32Bits(-0), 0x80000000)
  assert.equal(f32Bits(Infinity), 0x7f800000)
  assert.equal(f32Bits(FLOAT32_MIN_NORMAL), 0x00800000)
  assert.equal(f32Bits(2 ** -149), 1)
})

test('a double reads as the float32 it rounds to, and bits read back as that float32', () => {
  const next = lcgRandom(1521)
  for (let i = 0; i < 10_000; i++) {
    const value = (next() - 0.5) * 10 ** Math.floor(next() * 40 - 20)
    const bits = f32Bits(value)
    assert.equal(bits, f32Bits(Math.fround(value)))
    assert.ok(Number.isInteger(bits) && bits >= 0 && bits < 2 ** 32)
    assert.equal(fromF32Bits(bits), Math.fround(value))
  }
  assert.ok(Object.is(fromF32Bits(0x80000000), -0))
  assert.equal(fromF32Bits(-1), fromF32Bits(0xffffffff), 'a word is taken modulo 2³²')
  assert.ok(Number.isNaN(fromF32Bits(0x7fc00000)))
})
