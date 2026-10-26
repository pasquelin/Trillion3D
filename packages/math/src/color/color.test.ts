import test from 'node:test'
import assert from 'node:assert/strict'
import { hslToRgb, linearToSrgb, srgbToLinear } from './color.ts'

test('srgbToLinear: bounds and linear branch at the 0.04045 threshold inclusive', () => {
  assert.equal(srgbToLinear(0), 0)
  assert.equal(srgbToLinear(1), 1)
  assert.equal(srgbToLinear(0.04045), 0.04045 / 12.92)
})

test('linearToSrgb: bounds and linear branch at the 0.0031308 threshold inclusive', () => {
  assert.equal(linearToSrgb(0), 0)
  assert.equal(linearToSrgb(0.0031308), 12.92 * 0.0031308)
})

test('linearToSrgb: below the threshold, the linear branch lets a negative through without clamping to zero', () => {
  // Only the exponent (branch beyond the threshold, where the input is already positive) clamps
  // negatives to zero before `Math.pow`; the linear branch clips nothing.
  assert.equal(linearToSrgb(-0.5), 12.92 * -0.5)
})

test('round-trip srgbToLinear then linearToSrgb: identity within 1e-9 over all of [0, 1]', () => {
  let worst = 0
  for (let i = 0; i <= 256; i++) {
    const c = i / 256
    worst = Math.max(worst, Math.abs(linearToSrgb(srgbToLinear(c)) - c))
  }
  assert.ok(worst < 1e-9, `round-trip discrepancy ${worst}`)
})

test('hslToRgb writes from the given offset `o`, without touching the rest of the buffer', () => {
  const out = new Float64Array(5).fill(-1)
  hslToRgb(out, 1, 0.5, 0.5, 0.5)
  // h = 0.5, s = 0.5, l = 0.5: q = 0.75, p = 0.25, red takes p, green the ramp's 0.75, blue q.
  const expected = [0.25, 0.75, 0.75]
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(out[1 + i] - expected[i]) < 1e-12)
  assert.equal(out[0], -1)
  assert.equal(out[4], -1)
})

test('hslToRgb: zero saturation yields a grey of the lightness', () => {
  const out = new Float64Array(3)
  hslToRgb(out, 0, 0.77, 0, 0.33)
  assert.equal(out[0], out[1])
  assert.equal(out[1], out[2])
  assert.ok(Math.abs(out[0] - 0.33) < 1e-12)
})

test('hslToRgb returns the buffer it received, gray branch included', () => {
  const out = new Float64Array(3)
  assert.equal(hslToRgb(out, 0, 0.25, 0.8, 0.5), out)
  assert.equal(hslToRgb(out, 0, 0.25, 0, 0.5), out, 'zero saturation returns early')
})
