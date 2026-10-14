import test from 'node:test'
import assert from 'node:assert/strict'
import { lcgRandom } from '../sequence/random.ts'
import { FLOAT32_MAX, FLOAT32_MIN_NORMAL } from '../constants.ts'
import { f32Bits, f32Up, fromF32Bits } from './bits.ts'

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

test('a double rounds up to the least float32 at or above it, never below, one step at most', () => {
  const next = lcgRandom(1527)
  for (let i = 0; i < 10_000; i++) {
    const value = (next() - 0.5) * 10 ** Math.floor(next() * 90 - 60)
    const up = f32Up(value)
    assert.equal(up, Math.fround(up))
    assert.ok(up >= value, `${up} holds ${value}`)
    const below = fromF32Bits(up > 0 ? f32Bits(up) - 1 : up < 0 ? f32Bits(up) + 1 : 0x80000001)
    assert.ok(below < value, `${below}, the float32 below ${up}, is under ${value}`)
  }
  assert.equal(f32Up(1), 1)
  assert.equal(f32Up(1 + 2 ** -30), 1 + 2 ** -23)
  assert.equal(f32Up(-1 - 2 ** -30), -1)
  assert.equal(f32Up(2 ** -160), 2 ** -149, 'past zero, the least subnormal')
  assert.ok(Object.is(f32Up(-(2 ** -160)), -0))
  assert.equal(f32Up(-(2 ** 130)), -FLOAT32_MAX)
  assert.equal(f32Up(2 ** 130), Infinity)
  assert.ok(Number.isNaN(f32Up(NaN)))
})
