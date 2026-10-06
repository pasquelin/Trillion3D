import test from 'node:test'
import assert from 'node:assert/strict'
import { reflectionResolveExtent } from './resolveGl.ts'
import { REFLECTION_RESOLVE_PIXELS } from './resolvePixels.ts'

test('a mirror whose image already fits the budget resolves at the image size', () => {
  assert.deepEqual(reflectionResolveExtent(256, 256), [256, 256])
  assert.deepEqual(reflectionResolveExtent(1, 1), [1, 1])
  assert.deepEqual(reflectionResolveExtent(0, 0), [1, 1])
})

test('a larger mirror resolves at the budget, never above it, keeping the image aspect', () => {
  for (const [width, height] of [
    [1728, 1117],
    [3456, 2234],
    [3840, 2160],
    [8000, 6000],
  ]) {
    const [w, h] = reflectionResolveExtent(width, height)
    assert.ok(w > 0 && h > 0 && w <= width && h <= height, `${w}x${h} within ${width}x${height}`)
    assert.ok(w * h <= REFLECTION_RESOLVE_PIXELS, `${w * h} within the budget`)
    assert.ok(Math.abs(w / h - width / height) < 0.02, `${w}x${h} keeps the aspect`)
  }
})
