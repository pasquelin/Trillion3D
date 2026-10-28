// The room a capsule shadow view keeps and where each pass of an image finds its windows.
import test from 'node:test'
import assert from 'node:assert/strict'
import { CAPSULE_SLOTS, capsuleRoom, slotOffsets, type CapsuleView } from './view.ts'

test('the room is a power of two of at least 64', () => {
  assert.deepEqual([0, 1, 64, 65, 1000].map(capsuleRoom), [64, 64, 64, 128, 1024])
})

test('each slot has windows of its own, aligned to 256 bytes and apart by the window’s size', () => {
  const view = { window: { shapes: 2048, lights: 1024, casters: 256 } } as CapsuleView
  const first = slotOffsets(view, 0)
  const next = slotOffsets(view, 1)
  assert.deepEqual(Object.values(first), [0, 0, 0, 0, 0, 0])
  assert.equal(next.shapes - first.shapes, 2048)
  assert.equal(next.lights - first.lights, 1024)
  for (const value of Object.values(slotOffsets(view, CAPSULE_SLOTS - 1)))
    assert.equal(value % 256, 0)
})
