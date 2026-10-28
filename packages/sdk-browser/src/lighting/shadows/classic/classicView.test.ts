import test from 'node:test'
import assert from 'node:assert/strict'
import { VSM_DEFAULT_SHADOWS } from '../vsm/mapSettings.ts'
import { VSM_UNIT_PER_CM } from '../vsm/constants.ts'
import { CLASSIC_VEC4S, classicBiasWord, writeClassicView } from './classicView.ts'

test('the block holds a sun a slot, the biases and the view’s words, in the shader’s units', () => {
  const out = new Float32Array(4 * CLASSIC_VEC4S + 4)
  writeClassicView(out, 2, [{ mapId: 8192, firstLevel: 6 }], VSM_DEFAULT_SHADOWS, 10)
  const at = 2
  // The sun: 400 m, three times as long a cascade each, a tenth fade, four cascades.
  assert.ok(Math.abs(out[at]! - 40000 * VSM_UNIT_PER_CM) < 1e-4)
  assert.deepEqual([out[at + 1], out[at + 3], out[at + 4], out[at + 5]], [3, 4, 8192, 6])
  assert.equal(out[at + 2], Math.fround(0.1))
  // An empty slot holds no map.
  assert.equal(out[at + 8 + 4], -1)
  // The biases: the sun's, the point light's, the spot's, then the user bias and the near plane.
  assert.deepEqual(
    [out[at + 64], out[at + 65], out[at + 66], out[at + 67]],
    [10, 3, Math.fround(0.9), 2048],
  )
  assert.ok(Math.abs(out[at + 68]! - 0.02) < 1e-6)
  assert.deepEqual([out[at + 72], out[at + 75]], [3, 0.5])
  assert.ok(Math.abs(out[at + 76]! - 10 * VSM_UNIT_PER_CM) < 1e-6)
  assert.equal(out[at + 77], 1)
  // The words past the block are untouched.
  assert.equal(out[2 + 4 * CLASSIC_VEC4S], 0)
})

test('a light’s two bias factors pack in a word, 16 bits each over 0 to 4', () => {
  const word = classicBiasWord(1, 2)
  assert.equal(word & 0xffff, 16384)
  assert.equal(word >>> 16, 32768)
  assert.equal(classicBiasWord(), classicBiasWord(0.5, 0.5))
  assert.equal(classicBiasWord(9, -1), 0x0000ffff)
})
