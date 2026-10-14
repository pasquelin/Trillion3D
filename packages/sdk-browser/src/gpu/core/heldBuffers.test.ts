// A grown buffer follows the engine's one growth rule for a buffer the CPU grows (`sizedBuffer`):
// the first ask exactly, then twice the held size at least. The outgrown one is retired, destroyed
// after the frame's submit; a growth refused keeps it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { heldBuffers } from './heldBuffers.ts'
import { destroyRetired } from './frameRetire.ts'

test('a grown buffer is made at the size asked, then at twice the held size at least', () => {
  const { device } = fakeDevice()
  const held = heldBuffers()
  const grow = (size: number) => held.grow(device, 'grown', size, GPUBufferUsage.STORAGE).size
  assert.equal(grow(12), 12, 'the first ask, exactly: no power of two padding')
  assert.equal(grow(13), 24, 'a slightly larger ask doubles')
  assert.equal(grow(100), 100, 'an ask past twice the held size is taken as it is')
})

test('a grown buffer is kept while it holds the size asked', () => {
  const { device } = fakeDevice()
  const held = heldBuffers()
  const first = held.grow(device, 'kept', 8, GPUBufferUsage.STORAGE)
  assert.equal(held.grow(device, 'kept', 8, GPUBufferUsage.STORAGE), first)
  assert.equal(held.grow(device, 'kept', 4, GPUBufferUsage.STORAGE), first)
  assert.equal(held.grow(device, 'kept', 9, GPUBufferUsage.STORAGE).size, 16)
})

test('an outgrown buffer lives until the frame is submitted, and a refused growth keeps it', () => {
  const { device, destroyed, fences } = fakeDevice()
  const held = heldBuffers()
  const first = held.grow(device, 'grown', 8, GPUBufferUsage.STORAGE)
  const create = device.createBuffer.bind(device)
  device.createBuffer = () => {
    throw new Error('GPU_BUDGET_EXCEEDED')
  }
  assert.throws(() => held.grow(device, 'grown', 64, GPUBufferUsage.STORAGE), /GPU_BUDGET/)
  assert.equal(held.grow(device, 'grown', 8, GPUBufferUsage.STORAGE), first, 'refused: still held')
  device.createBuffer = create
  const second = held.grow(device, 'grown', 64, GPUBufferUsage.STORAGE)
  assert.notEqual(second, first)
  assert.ok(!destroyed.includes(first), 'the image encoded may still name it')
  assert.equal(fences(), 0, 'no promise per buffer')
  destroyRetired(device)
  assert.ok(destroyed.includes(first), 'destroyed once the frame is submitted')
})
