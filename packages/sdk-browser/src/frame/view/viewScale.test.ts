// A view drawn beside the main one: a number fixes its scale, `'auto'` follows the world's one
// controller within its own bounds; its targets are made at its bounds' maximum, never capped.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createViewScale } from './viewScale.ts'

test('a fixed scale holds, whatever the world wants', () => {
  const scale = createViewScale(0.5, { wanted: () => 0.8 })
  assert.equal(scale.wanted(), 0.5)
  assert.equal(scale.allocated(), 0.5)
  assert.equal(scale.capMemory(), false)
})

test('an automatic scale follows the world within its bounds, and a new option applies at once', () => {
  let world = 0.7
  const scale = createViewScale({ min: 0.5, max: 0.9 }, { wanted: () => world })
  assert.equal(scale.wanted(), 0.7)
  world = 0.2
  assert.equal(scale.wanted(), 0.5, 'never below its minimum')
  assert.equal(scale.allocated(), 0.9, 'targets at its maximum')
  scale.set(1)
  assert.equal(scale.wanted(), 1)
  scale.drew(0.75, true)
  assert.equal(scale.drawn, 0.75)
  assert.equal(scale.steered, true)
})
