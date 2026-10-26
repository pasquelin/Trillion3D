// The bank pass's key choice (`bankWgsl.ts`), the shipped WGSL run as JavaScript: a track's length
// is its bake's frames less one over the bake's own rate, so the same second lies between other
// keys at another rate.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'
import { ANIMATION_BANK_WGSL } from './bankWgsl.ts'

type Keys = { lower: number; upper: number; blend: number }
const { bankKeys } = shaderRun<{ bankKeys: (time: number, frames: number, rate: number) => Keys }>(
  ANIMATION_BANK_WGSL,
  ['bankKeys'],
  {},
)

test('the keys a second lies between follow the bake’s rate: the same second, another frame', () => {
  const at = (time: number, rate: number) => Object.values(bankKeys(time, 25, rate))
  assert.deepEqual(at(0.5, 24), [12, 13, 0])
  assert.deepEqual(at(0.5, 30), [15, 16, 0])
  const between = bankKeys(0.5 + 0.25 / 24, 25, 24)
  assert.deepEqual([between.lower, between.upper], [12, 13])
  assert.ok(Math.abs(between.blend - 0.25) < 1e-4)
})

test('a second at or past the track’s length, which is 1 s of 25 frames at 24 and 0.8 s at 30, is its last key', () => {
  assert.deepEqual(Object.values(bankKeys(1, 25, 24)), [24, 0, 0])
  assert.deepEqual(Object.values(bankKeys(0.99, 25, 24)).slice(0, 2), [23, 24])
  assert.deepEqual(Object.values(bankKeys(0.9, 25, 30)), [24, 0, 0])
  assert.deepEqual(Object.values(bankKeys(0.7, 25, 30)).slice(0, 2), [21, 22])
})
