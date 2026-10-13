// A grown buffer takes the power of two at or above the size asked: never 0 bytes for an empty ask,
// and past 1 GiB still the next power of two, never a shift turned negative.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { heldBuffers } from './heldBuffers.ts'

test('a grown buffer is the power of two at or above its size, never 0 bytes', () => {
  const { device } = fakeDevice()
  const grow = (label: string, size: number) =>
    heldBuffers().grow(device, label, size, GPUBufferUsage.STORAGE).size
  assert.equal(grow('empty', 0), 1)
  assert.equal(grow('one', 1), 1)
  assert.equal(grow('five', 5), 8)
  assert.equal(grow('exact', 4096), 4096)
  assert.equal(grow('past a gibibyte', 2 ** 30 + 1), 2 ** 31)
})

test('a grown buffer is kept while it holds the size asked', () => {
  const { device } = fakeDevice()
  const held = heldBuffers()
  const first = held.grow(device, 'kept', 5, GPUBufferUsage.STORAGE)
  assert.equal(held.grow(device, 'kept', 8, GPUBufferUsage.STORAGE), first)
  assert.equal(held.grow(device, 'kept', 9, GPUBufferUsage.STORAGE).size, 16)
})
