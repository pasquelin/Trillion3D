import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslF32 } from './number.ts'

const F32_MAX = 3.4028234663852886e38

test('the literal names the f32 nearest the number, nine digits', () => {
  const cases: [number, string][] = [
    [0, '0.00000000'],
    [-0, '-0.00000000'],
    [2 ** -149, '1.40129846e-45'],
    [F32_MAX, '3.4028234663852886e+38'],
    [-F32_MAX, '-3.4028234663852886e+38'],
    [0.1, '0.100000001'],
    [1 / 3, '0.333333343'],
    [1, '1.00000000'],
    [-7, '-7.00000000'],
    [123456789, '123456792.0'],
    [Math.PI, '3.14159274'],
    [1 / Math.PI, '0.318309873'],
  ]
  for (const [value, text] of cases) {
    assert.equal(wgslF32(value), text, String(value))
    // Read back, it is the very f32, within the finite range a device accepts, never an integer.
    const read = Number(text)
    assert.ok(Object.is(Math.fround(read), Math.fround(value)), text)
    assert.ok(Math.abs(read) <= F32_MAX, text)
    assert.match(text, /[.e]/)
  }
})

test('the literals of f32 neighbours differ: nine digits tell every f32 apart', () => {
  const words = new Uint32Array(1)
  const floats = new Float32Array(words.buffer)
  for (const start of [0x00000001, 0x00800000, 0x3dcccccd, 0x3f800000, 0x4b800000, 0x7f7ffff0]) {
    for (let word = start; word < start + 16; word++) {
      words[0] = word
      assert.equal(Math.fround(Number(wgslF32(floats[0]))), floats[0], word.toString(16))
    }
  }
})

test('a number with no f32 is refused', () => {
  for (const value of [NaN, Infinity, -Infinity, 3.5e38, -1e39])
    assert.throws(() => wgslF32(value), RangeError, String(value))
})
