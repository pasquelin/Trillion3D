import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fromHalf, toHalf } from './half.ts'

/** IEEE 754 binary16: an exponent field of all ones is infinity or NaN, never a finite value. */
const HALF_INFINITY = 0x7c00
const finiteHalves = Array.from({ length: 1 << 16 }, (_, bits) => bits).filter(
  (bits) => (bits & HALF_INFINITY) !== HALF_INFINITY,
)

test('fromHalf reads normal, subnormal and signed halves to their exact values', () => {
  assert.equal(fromHalf(0x3c00), 1)
  assert.equal(fromHalf(0xc000), -2)
  assert.equal(fromHalf(0x3555), 0.333251953125)
  assert.equal(fromHalf(0x7bff), 65504, 'the largest finite half')
  assert.equal(fromHalf(0x0400), 2 ** -14, 'the smallest normal half')
  assert.equal(fromHalf(0x03ff), 1023 * 2 ** -24, 'the largest subnormal half')
  assert.equal(fromHalf(0x0001), 2 ** -24, 'the smallest subnormal half')
  assert.ok(Object.is(fromHalf(0x0000), 0))
  assert.ok(Object.is(fromHalf(0x8000), -0))
})

test('every finite half is the float32 the GPU unpacks from the same bits', () => {
  // A float32 holds every half exactly: its value rebuilt from the bits (exponent rebiased by
  // 127 - 15, fraction shifted by 13; a subnormal half normalised) is the reference.
  const word = new Uint32Array(1),
    float = new Float32Array(word.buffer)
  for (let bits = 0; bits < 0x10000; bits++) {
    const exponent = (bits >> 10) & 31
    if (exponent === 31) continue
    let fraction = bits & 1023,
      biased = exponent + 112
    if (!exponent && fraction) {
      biased = 113
      while (!(fraction & 1024)) {
        fraction <<= 1
        biased--
      }
      fraction &= 1023
    } else if (!exponent) biased = 0
    word[0] = ((bits & 0x8000) << 16) | (biased << 23) | (fraction << 13)
    assert.ok(Object.is(fromHalf(bits), float[0]), `half ${bits.toString(16)}`)
  }
})

test('every finite half reads back to its own bits', () => {
  const wrong = finiteHalves.filter((bits) => toHalf(fromHalf(bits)) !== bits)
  assert.deepEqual(wrong, [])
})

test('a value between two neighbouring halves is stored as the nearer one, on either sign', () => {
  const wrong: number[] = []
  for (let bits = 0; bits < HALF_INFINITY; bits++) {
    const low = fromHalf(bits),
      step = fromHalf(bits + 1) - low
    for (const sign of [1, -1]) {
      const negative = sign < 0 ? toHalf(-0) : 0
      if (toHalf(sign * (low + step / 4)) !== (bits | negative)) wrong.push(sign * bits)
      if (toHalf(sign * (low + (3 * step) / 4)) !== ((bits + 1) | negative)) wrong.push(sign * bits)
    }
  }
  assert.deepEqual(wrong, [])
})

test('a value halfway between two halves takes the even one, a NaN stays a NaN', () => {
  // Every float32 against IEEE 754 binary16 (`Float16Array`): 0 differences but NaN payloads.
  const one = 0x3c00,
    step = 2 ** -10
  assert.equal(toHalf(1 + step / 2), one, 'tie below an odd half: down to even')
  assert.equal(toHalf(1 + (3 * step) / 2), one + 2, 'tie below an even half: up to even')
  assert.equal(toHalf(-(1 + (3 * step) / 2)), (one + 2) | toHalf(-0))
  assert.equal(toHalf(2 ** -25), 0, 'half the smallest half: down to zero')
  assert.equal(toHalf(3 * 2 ** -25), 2, 'one and a half smallest halves: up to two')
  assert.equal(toHalf(65520), HALF_INFINITY, 'halfway past the largest half: infinity')
  // A float64 just off a tie that float32 rounds onto it: the side it lies on decides.
  assert.equal(toHalf(1 + (3 * step) / 2 - 2 ** -40), one + 1)
  assert.equal(toHalf(1 + step / 2 + 2 ** -40), one + 1)
  assert.equal(toHalf(NaN), 0x7e00)
})

test('values past the largest half store as infinity and values far below the smallest as zero', () => {
  const largest = fromHalf(HALF_INFINITY - 1)
  for (const value of [largest * 2, largest * 1e3, Number.MAX_VALUE, Infinity]) {
    assert.equal(toHalf(value), HALF_INFINITY, `${value}`)
    assert.equal(toHalf(-value), HALF_INFINITY | toHalf(-0), `${-value}`)
  }
  // Below a quarter of the smallest half, at every binary64 exponent down to the smallest float.
  const smallest = fromHalf(1)
  for (let shift = 2; smallest / 2 ** shift > 0; shift++) {
    const value = smallest / 2 ** shift
    assert.equal(toHalf(value), 0, `${value}`)
    assert.equal(toHalf(-value), toHalf(-0), `${-value}`)
  }
})
