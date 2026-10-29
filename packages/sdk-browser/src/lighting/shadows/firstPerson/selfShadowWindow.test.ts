import assert from 'node:assert/strict'
import test from 'node:test'
import { selfShadowWindows } from './selfShadowWindow.ts'

test('the low window is the rect at half the resolution with a margin, held to the grid', () => {
  const { low, full } = selfShadowWindows([100, 40, 201, 80], [320, 180])
  assert.deepEqual(low, [48, 18, 103, 42])
  assert.deepEqual(full, [100, 40, 201, 80])
})

test('a rect at the rim of the image keeps the window inside the grid', () => {
  const { low } = selfShadowWindows([0, 0, 640, 360], [320, 180])
  assert.deepEqual(low, [0, 0, 320, 180])
})
