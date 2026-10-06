import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BufferAttribute,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  ownAttribute,
  indexList,
} from './attribute.ts'

test('attribute components retain vertex offsets, normalization and independent copies', () => {
  const value = new BufferAttribute(new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]), 4)
  value.name = 'weights'
  assert.equal(value.count, 2)
  assert.deepEqual([value.getX(1), value.getY(1), value.getZ(1), value.getW(1)], [5, 6, 7, 8])
  value.setXYZ(1, 11, 12, 13).setW(1, 14)
  assert.deepEqual([...value.array], [1, 2, 3, 4, 11, 12, 13, 14])
  value.setX(0, 21)
  value.setY(0, 22)
  value.setZ(0, 23)
  value.setW(0, 24)
  assert.deepEqual([...value.array], [21, 22, 23, 24, 11, 12, 13, 14])
  const clone = value.clone()
  assert.equal(clone.name, 'weights')
  assert.equal(clone.itemSize, 4)
  assert.equal(clone.type, 'Float32Array')
  assert.equal(clone.normalized, false)
  assert.notEqual(clone.array, value.array)
  clone.setX(0, 1)
  assert.equal(value.getX(0), 21)
  const ordered = ownAttribute(value, [1, 0, 1])
  assert.deepEqual([...ordered.array], [11, 12, 13, 14, 21, 22, 23, 24, 11, 12, 13, 14])
  const normalized = new BufferAttribute(new Uint8Array([0, 255, 128]), 3, true)
  assert.equal(normalized.getX(0), 0)
  assert.equal(normalized.getY(0), 1)
  normalized.setZ(0, 1)
  assert.equal(normalized.array[2], 255)
  assert.equal(normalized.clone().normalized, true)
})

test('interleaved views share writes but extracted attributes own only selected components', () => {
  const buffer = new InterleavedBuffer(new Float32Array([91, 1, 2, 3, 92, 4, 5, 6, 93]), 4)
  const view = new InterleavedBufferAttribute(buffer, 3, 1)
  assert.equal(buffer.count, 2)
  assert.equal(view.count, 2)
  assert.equal(view.array, buffer.array)
  assert.deepEqual([view.getX(1), view.getY(1), view.getZ(1)], [4, 5, 6])
  view.setXYZ(1, 7, 8, 9)
  assert.deepEqual([...buffer.array], [91, 1, 2, 3, 92, 7, 8, 9, 93])
  const extracted = buffer.attribute(3, 1)
  assert.deepEqual([...extracted.array], [1, 2, 3, 7, 8, 9])
  assert.deepEqual([...view.clone().array], [1, 2, 3, 7, 8, 9])
  extracted.setX(1, 40)
  assert.equal(view.getX(1), 7)
  buffer.needsUpdate = false
  assert.equal(buffer.version, 0)
  view.needsUpdate = true
  assert.equal(buffer.version, 1)
  buffer.needsUpdate = true
  assert.equal(buffer.version, 2)
  assert.equal(view.needsUpdate, false)
  assert.equal(buffer.needsUpdate, false)
})

test('upload ranges and revisions track declared writes and index width preserves large vertices', () => {
  const value = new BufferAttribute(new Float32Array([1, 2, 3]), 3)
  let writes = 0
  value._onChange = () => writes++
  value.needsUpdate = false
  assert.equal(value.version, 0)
  assert.equal(writes, 0)
  value.needsUpdate = true
  assert.equal(value.version, 1)
  assert.equal(writes, 1)
  value.needsUpdate = true
  assert.equal(value.version, 2)
  assert.equal(writes, 2)
  assert.equal(value.needsUpdate, false)
  value.addUpdateRange(2, 3)
  value.addUpdateRange(7, 11)
  assert.deepEqual(value.updateRanges, [
    { start: 2, count: 3 },
    { start: 7, count: 11 },
  ])
  value.clearUpdateRanges()
  assert.deepEqual(value.updateRanges, [])
  assert.deepEqual([...indexList([0, 65535, 1]).array], [0, 65535, 1])
  assert.ok(indexList([0, 65535]).array instanceof Uint16Array)
  const wide = indexList([1, 65536, 3])
  assert.ok(wide.array instanceof Uint32Array)
  assert.deepEqual([...wide.array], [1, 65536, 3])
})
