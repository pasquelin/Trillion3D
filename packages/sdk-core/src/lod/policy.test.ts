import test from 'node:test'
import assert from 'node:assert/strict'
import { halton } from '../../../math/src/sequence/halton.ts'
import { LOD_QUALITY, lodQuality, adaptivePixelError } from './policy.ts'
test('LOD presets are explicit pixel-error configurations', () => {
  assert.equal(lodQuality('source').pixelError, 0)
  assert.equal(LOD_QUALITY.high.pixelError, 1)
  assert.equal(LOD_QUALITY.balanced.pixelError, 4)
  assert.equal(LOD_QUALITY.adaptive.adaptive, true)
  assert.throws(() => lodQuality('nope'))
})
test('adaptive error grows with speed and stays at the base when still', () => {
  assert.equal(adaptivePixelError(2, 0, 10), 2)
  assert.ok(adaptivePixelError(2, 20, 10) > 2)
  assert.ok(adaptivePixelError(2, 1e9, 10) <= 2 * 5)
})

test('the adaptive error is the one the inline clamp gave, on a sweep and its edges', () => {
  // `speed / max(radius / 8, 1e-6)` is +0 or positive and finite past the guards: the comparison
  // clamp to [0, 4] keeps it as `Math.min(4, …)` did.
  const old = (base: number, speed: number, radius: number) =>
    base * (1 + Math.min(4, speed / Math.max(radius / 8, 1e-6)))
  const cases = [
    [2, -0, 10],
    [2, 0, 1e-9],
    [1, 32, 64],
    [4, 1e300, 1e-300],
    [0, 5, 1],
  ]
  for (let i = 1; i <= 4096; i++)
    cases.push([halton(i, 2) * 8, halton(i, 3) * 2 ** 10, 2 ** (halton(i, 5) * 40 - 20)])
  for (const [base, speed, radius] of cases)
    assert.ok(Object.is(adaptivePixelError(base, speed, radius), old(base, speed, radius)))
})
