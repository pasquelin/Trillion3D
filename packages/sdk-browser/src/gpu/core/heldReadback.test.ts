// An explicit capture reads the image back through the device's capture ring, the engine's one
// staging pool: one capture after another reuses its buffer, captures at once take one each, and
// the ring is destroyed once no capture came. Each capture's pixels are an array of its own.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { readGpuImage } from './readback.ts'
import { HOLD_IDLE_MS } from './heldBuffers.ts'

const capturing = () => {
  const gpu = fakeDevice(),
    { device } = gpu
  const make = device.createCommandEncoder.bind(device)
  device.createCommandEncoder = (descriptor) =>
    Object.assign(make(descriptor), { copyTextureToBuffer() {} })
  const made = () => gpu.buffers.filter(({ label }) => label === 'Trillion3D explicit capture')
  return { gpu, device, made }
}

test('captures one after another read through one buffer, each into pixels of its own', async () => {
  const { device, made } = capturing()
  const capture = (height = 4) => readGpuImage(device, {} as GPUTexture, 8, height)
  const [first, second] = [await capture(), await capture()]
  assert.notEqual(first, second, 'pixels of its own')
  assert.equal(made().length, 1, 'the second capture took the same buffer')
  await Promise.all([capture(), capture()])
  assert.equal(made().length, 2, 'two at once: one buffer each')
  await capture(4)
  assert.equal(made().length, 2, 'a capture of a size held makes none')
})

test('the capture ring is destroyed once idle', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const { gpu, device, made } = capturing()
  await readGpuImage(device, {} as GPUTexture, 8, 4)
  assert.equal(gpu.destroyed.length, 0, 'held after its capture')
  context.mock.timers.tick(HOLD_IDLE_MS)
  assert.equal(gpu.destroyed.length, 1, 'given back to the device')
  await readGpuImage(device, {} as GPUTexture, 8, 4)
  assert.equal(made().length, 2, 'the next capture makes one again')
})
