import test from 'node:test'
import assert from 'node:assert/strict'
import { createBounceCascades } from '../../../../../sdk-core/src/bounce/cascades.ts'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { installGpuDeviceLedger } from '../../../gpu/core/deviceLedger.ts'
import { createProbeStorage } from './probeStorage.ts'

test('a refused probe snapshot releases the entire new probe bundle, preserving earlier resources', () => {
  const gpu = fakeDevice({
    limits: { maxStorageBufferBindingSize: 1 << 28, maxBufferSize: 1 << 28 },
  })
  let ceiling = 1e9
  const ledger = installGpuDeviceLedger(gpu.device, { limit: () => ceiling })
  const previous = gpu.device.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE })
  const cascades = createBounceCascades([0, 0, 0, 20, 3, 3])
  const originalCreate = gpu.device.createTexture.bind(gpu.device)
  gpu.device.createTexture = (descriptor) => {
    if (descriptor.label === 'Trillion3D bounce probes snapshot v4') ceiling = ledger.bytes
    return originalCreate(descriptor)
  }
  assert.throws(
    () => createProbeStorage(gpu.device, cascades, 16, 32, [11, 1, 2]),
    /GPU_BUDGET_EXCEEDED/,
  )
  assert.equal(ledger.bytes, 64)
  assert.equal(gpu.destroyed.includes(previous), false)
  assert.ok(gpu.buffers.length > 3, 'several successful creations precede the refused snapshot')
  const made = [...gpu.buffers.slice(1), ...gpu.textures]
  assert.ok(made.every((resource) => gpu.destroyed.includes(resource)))
  assert.ok(
    gpu.textures.every((texture) => texture.label !== 'Trillion3D bounce probes snapshot v4'),
  )
})

test('the probes and their snapshot are two atlases of one extent, written as storage and read, never attached', () => {
  const gpu = fakeDevice({
    limits: { maxStorageBufferBindingSize: 1 << 28, maxBufferSize: 1 << 28 },
  })
  const extent: [number, number, number] = [11, 1, 2]
  const storage = createProbeStorage(
    gpu.device,
    createBounceCascades([0, 0, 0, 20, 3, 3]),
    16,
    32,
    extent,
  )
  // No level is cleared any more: a probe is told to the shaders by the table, and the atlases start
  // zeroed — no probe, no entry.
  assert.deepEqual(gpu.passes, [])
  const atlases = [storage.probes, storage.snapshot]
  for (const atlas of atlases) {
    assert.deepEqual([atlas.width, atlas.height, atlas.depthOrArrayLayers], extent)
    assert.equal(
      atlas.usage,
      GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      'no render attachment',
    )
  }
  assert.equal(storage.records.size, 32)
  assert.equal(storage.queue.size, 16)
})
