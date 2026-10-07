// An explicit capture reads the image back through a mapped buffer the device holds between
// captures: one of the same size makes none, two at once never share one, another size swaps it.
// Each capture's pixels are an array of its own.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { readGpuImage } from './readback.ts'
import { READBACK_IDLE_MS } from './heldReadback.ts'

test('captures of one size read through one held buffer, each into pixels of its own', async () => {
  const gpu = fakeDevice(),
    { device } = gpu
  const make = device.createCommandEncoder.bind(device)
  device.createCommandEncoder = (descriptor) =>
    Object.assign(make(descriptor), { copyTextureToBuffer() {} })
  const texture = {} as GPUTexture,
    capture = (height = 4) => readGpuImage(device, texture, 8, height)
  const made = () => gpu.buffers.filter(({ label }) => label === 'Trillion3D explicit capture')
  const [first, second] = [await capture(), await capture()]
  assert.notEqual(first, second, 'pixels of its own')
  assert.equal(made().length, 1, 'the second capture took the held buffer')
  await Promise.all([capture(), capture()])
  assert.equal(made().length, 2, 'two at once: the second took a fresh one')
  assert.equal(gpu.destroyed.length, 1, 'one held after them, the other destroyed')
  await capture(8)
  assert.equal(made().length, 3, 'another size: another buffer')
  assert.equal(gpu.destroyed.length, 2, 'which replaces the held one')
  await capture(8)
  assert.equal(made().length, 3)
})

test('a held buffer no capture takes is destroyed once idle', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const gpu = fakeDevice(),
    { device } = gpu
  const make = device.createCommandEncoder.bind(device)
  device.createCommandEncoder = (descriptor) =>
    Object.assign(make(descriptor), { copyTextureToBuffer() {} })
  await readGpuImage(device, {} as GPUTexture, 8, 4)
  assert.equal(gpu.destroyed.length, 0, 'held after its capture')
  context.mock.timers.tick(READBACK_IDLE_MS)
  assert.equal(gpu.destroyed.length, 1, 'given back to the device')
  await readGpuImage(device, {} as GPUTexture, 8, 4)
  const made = gpu.buffers.filter(({ label }) => label === 'Trillion3D explicit capture')
  assert.equal(made.length, 2, 'the next capture makes one again')
})
