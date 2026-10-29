// The display's helpers (`ptPerceptualError`, `colorMapTurbo`, `ptFinite`) and the error chain's reads, run in JavaScript from the shipped text.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { PT_ADAPTIVE_UTILS_WGSL } from './adaptiveUtilsWgsl.ts'
import { PT_DISPLAY_WGSL } from './displayWgsl.ts'

test('the perceptual error is the error times the slope of the filmic curve', () => {
  const { ptPerceptualError } = shaderRun<{ ptPerceptualError: (m: number, e: number) => number }>(
    PT_ADAPTIVE_UTILS_WGSL,
    ['ptPerceptualError'],
    {},
  )
  const curve = (x: number) => ((6 * x) / (6 * x + 1)) ** 2
  const mean = 0.4,
    h = 1e-6
  const slope = (curve(mean + h) - curve(mean - h)) / (2 * h)
  assert.ok(Math.abs(ptPerceptualError(mean, 0.01) - 0.01 * slope) < 1e-6)
})

test('the rainbow ramps from dark blue to dark red and holds its ends', () => {
  const { colorMapTurbo } = shaderRun<{ colorMapTurbo: (t: number) => number[] }>(
    PT_DISPLAY_WGSL,
    ['colorMapTurbo'],
    {},
  )
  assert.deepEqual(colorMapTurbo(-3), colorMapTurbo(0))
  assert.deepEqual(colorMapTurbo(7), colorMapTurbo(1))
  assert.ok(colorMapTurbo(0)[2] > colorMapTurbo(0)[0])
  assert.ok(colorMapTurbo(1)[0] > colorMapTurbo(1)[2])
})

test('a pixel with a component past half precision is held to its largest finite value', () => {
  const { ptFinite } = shaderRun<{ ptFinite: (v: number[]) => number[] }>(
    PT_DISPLAY_WGSL,
    ['ptFinite'],
    {},
  )
  assert.deepEqual(ptFinite([1, Infinity, NaN, -2]), [1, 65504, 65504, -2])
})
