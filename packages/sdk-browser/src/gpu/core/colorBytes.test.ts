import test from 'node:test'
import assert from 'node:assert/strict'
import { colorBytesPerSample } from './colorBytes.fixture.ts'

test('colour bytes per sample follow WebGPU: each cost aligned to its own alignment, in order', () => {
  // An 8-bit four-channel target costs 8; a 32-bit one aligns to 4 after an 8-bit one.
  assert.equal(colorBytesPerSample(['rgba8unorm']), 8)
  assert.equal(colorBytesPerSample(['r8uint', 'r32uint']), 8)
  assert.equal(colorBytesPerSample(['rgba16float', undefined, 'rg8unorm', 'rgba8unorm']), 18)
  // A two-channel 32-bit target (the TAA resolve's) costs 8, aligned to 4.
  assert.equal(colorBytesPerSample(['r8uint', 'rg32uint']), 12)
  assert.throws(() => colorBytesPerSample(['rgba32float']), /no colour byte cost/)
})
