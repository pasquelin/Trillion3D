import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SCREEN_REFLECTION_LEVEL_CODE,
  pixelRadiusScale,
  previousScreenScaleBias,
  reducedColorScaleBias,
  reducedColorSize,
  screenGiConfig,
  screenReflectionMarch,
  screenReflectionParams,
} from './screenSpaceQuality.ts'
import { roughnessMaskScale } from './screenSpaceMask.ts'

test('each reflection level spends its steps and rays; the medium level is glossy only for a denoiser', () => {
  assert.deepEqual(screenReflectionMarch(1), { steps: 8, rays: 1, glossy: false })
  assert.deepEqual(screenReflectionMarch(2), { steps: 16, rays: 1, glossy: false })
  assert.deepEqual(screenReflectionMarch(2, true), { steps: 16, rays: 1, glossy: true })
  assert.deepEqual(screenReflectionMarch(3), { steps: 8, rays: 4, glossy: true })
  assert.deepEqual(screenReflectionMarch(4), { steps: 12, rays: 12, glossy: true })
  assert.deepEqual(Object.values(SCREEN_REFLECTION_LEVEL_CODE), [0, 1, 2, 3, 4])
})

test('the roughness fade is 1 at half the maximum roughness and 0 at it; the low levels double the scale', () => {
  const fade = (roughness: number, max: number, code: number) =>
    Math.min(roughness * roughnessMaskScale(max, code) + 2, 1)
  assert.ok(Math.abs(fade(0.3, 0.6, 3) - 1) < 1e-12)
  assert.ok(Math.abs(fade(0.6, 0.6, 3)) < 1e-12)
  assert.ok(Math.abs(fade(0.3, 0.6, 1)) < 1e-12)
  assert.equal(roughnessMaskScale(0, 3), -2 / 0.01)
  assert.equal(roughnessMaskScale(5, 3), -2)
})

test('the parameters pack the intensity in 0..1, the scale, the discard and the turn times 1551', () => {
  assert.deepEqual(screenReflectionParams(100, 0.6, 3, false, 5), [1, -2 / 0.6, 0, 7755])
  assert.deepEqual(screenReflectionParams(250, 1, 1, true, 0), [1, -4, 1, 0])
  assert.equal(screenReflectionParams(40, 1, 3, false, 0)[0], 0.4)
})

test('the indirect light spends 256 lanes a group at every quality, and clamps its level to 1..4', () => {
  for (const level of [1, 2, 3, 4]) {
    const { rays, tileX, tileY } = screenGiConfig(level)
    assert.equal(rays * tileX * tileY, 256)
  }
  assert.deepEqual(screenGiConfig(1), { quality: 1, rays: 4, steps: 8, tileX: 8, tileY: 8 })
  assert.deepEqual(screenGiConfig(4), { quality: 4, rays: 32, steps: 12, tileX: 4, tileY: 2 })
  assert.equal(screenGiConfig(0).quality, 1)
  assert.equal(screenGiConfig(9).quality, 4)
})

test('the reduced chain starts at half the depth rounded up to sixteen, and its scale and bias place a hit in it', () => {
  assert.deepEqual(reducedColorSize(1920, 1080), [960, 544])
  assert.deepEqual(reducedColorSize(100, 100), [64, 64])
  const { scaleBias, uvMax } = reducedColorScaleBias([1920, 1080], [1920, 1080], [0, 0], [960, 544])
  assert.deepEqual(scaleBias, [1, 540 / 544, -0, -0])
  assert.ok(Math.abs(uvMax[0] - 959.5 / 960) < 1e-12)
})

test('the last image places a clip position by its extent and offset in its buffer; a pixel radius grows with the depth under a perspective', () => {
  assert.deepEqual(
    previousScreenScaleBias([100, 50], [10, 20], [200, 100]),
    [0.25, -0.25, 0.3, 0.45],
  )
  assert.deepEqual(pixelRadiusScale(true, 0.5, 100), [0.005, 0])
  assert.deepEqual(pixelRadiusScale(false, 1, 100), [0, 1])
})
