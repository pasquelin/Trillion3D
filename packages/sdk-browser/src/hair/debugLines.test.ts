import assert from 'node:assert/strict'
import test from 'node:test'
import { createDebugLines, DEBUG_COLORS, DEBUG_LINE_FLOATS } from './debugLines.ts'

test('a box is twelve edges, written relative to the eye', () => {
  const lines = createDebugLines()
  lines.begin([10, 0, 0])
  lines.box([10, 0, 0], [11, 1, 1], DEBUG_COLORS.red)
  assert.equal(lines.count, 12)
  // The first edge runs from the low corner (the eye's place) along x.
  assert.deepEqual([...lines.data.subarray(0, 3)], [0, 0, 0])
  assert.deepEqual([...lines.data.subarray(4, 7)], [1, 0, 0])
  assert.equal(new Uint32Array(lines.data.buffer)[3], DEBUG_COLORS.red)
  assert.equal(lines.data[7], 0)
})

test('a box in a frame is carried to the world by its axes', () => {
  const lines = createDebugLines()
  lines.begin([0, 0, 0])
  // The frame turns x to the world's y.
  lines.box([0, 0, 0], [1, 1, 1], DEBUG_COLORS.green, [0, 1, 0, -1, 0, 0, 0, 0, 1])
  assert.deepEqual([...lines.data.subarray(4, 7)], [0, 1, 0])
})

test('pixel lines, rects and text are in the display space', () => {
  const lines = createDebugLines()
  lines.begin([0, 0, 0])
  lines.rect(0, 0, 10, 10, DEBUG_COLORS.green)
  assert.equal(lines.count, 4)
  const before = lines.count
  lines.text('A', 5, 5, DEBUG_COLORS.white)
  assert.ok(lines.count > before)
  for (let line = 0; line < lines.count; line++)
    assert.equal(lines.data[line * DEBUG_LINE_FLOATS + 7], 1)
})

test('the frustum of the clip box is the world box that maps onto it', () => {
  const lines = createDebugLines()
  lines.begin([0, 0, 0])
  // Clip from the world: x and y halved, z unchanged.
  const matrix = [0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  lines.frustum(matrix, 0.25, 0.75, DEBUG_COLORS.blue)
  assert.equal(lines.count, 12)
  const xs = new Set<number>()
  for (let line = 0; line < 12; line++) xs.add(lines.data[line * DEBUG_LINE_FLOATS])
  assert.deepEqual([...xs].sort(), [-2, 2])
})
