import test from 'node:test'
import assert from 'node:assert/strict'
import { createBounceCascades } from '../../../../../sdk-core/src/bounce/cascades.ts'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { installGpuDeviceLedger } from '../../../gpu/core/deviceLedger.ts'
import { createProbeStorage } from './probeStorage.ts'

test('a refused cell table releases the entire new probe bundle, preserving earlier resources', () => {
  const gpu = fakeDevice({
    limits: { maxStorageBufferBindingSize: 1 << 28, maxBufferSize: 1 << 28 },
  })
  let ceiling = 1e9
  const ledger = installGpuDeviceLedger(gpu.device, { limit: () => ceiling })
  const previous = gpu.device.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE })
  const cascades = createBounceCascades([0, 0, 0, 20, 3, 3])
  const originalCreate = gpu.device.createTexture.bind(gpu.device)
  gpu.device.createTexture = (descriptor) => {
    if (descriptor.label === 'Trillion3D bounce cell table v1') ceiling = ledger.bytes
    return originalCreate(descriptor)
  }
  assert.throws(
    () => createProbeStorage(gpu.device, cascades, 16, [11, 1, 1]),
    /GPU_BUDGET_EXCEEDED/,
  )
  assert.equal(ledger.bytes, 64)
  assert.equal(gpu.destroyed.includes(previous), false)
  assert.ok(gpu.buffers.length > 2, 'several successful creations precede the refused table')
  const made = [...gpu.buffers.slice(1), ...gpu.textures]
  assert.ok(made.every((resource) => gpu.destroyed.includes(resource)))
  assert.ok(gpu.textures.every((texture) => texture.label !== 'Trillion3D bounce cell table v1'))
})

test('the cell table is one atlas of its extent, written as storage and read, never attached', () => {
  const gpu = fakeDevice({
    limits: { maxStorageBufferBindingSize: 1 << 28, maxBufferSize: 1 << 28 },
  })
  const extent: [number, number, number] = [11, 1, 1]
  const storage = createProbeStorage(
    gpu.device,
    createBounceCascades([0, 0, 0, 20, 3, 3]),
    16,
    extent,
  )
  // No level is cleared any more: a probe is told to the shaders by the table, which starts zeroed — no entry names a probe.
  assert.deepEqual(gpu.passes, [])
  const { table } = storage
  assert.deepEqual([table.width, table.height, table.depthOrArrayLayers], extent)
  assert.equal(
    table.usage,
    GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    'no render attachment',
  )
  assert.equal(storage.queue.size, 16)
})
