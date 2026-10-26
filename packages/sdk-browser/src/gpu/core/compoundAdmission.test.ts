import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { constructGpuResources, installGpuDeviceLedger } from './deviceLedger.ts'
import { createBinStages, createGpuBins } from '../../visibility/bins/bins.ts'

// The bins' first buffer, for one cluster of three corners: its one instance word
// (`createGpuBins`).
const INSTANCE_BYTES = 4

test('bins initial second-buffer refusal rolls back only the partial constructor', () => {
  const gpu = fakeDevice()
  const ledger = installGpuDeviceLedger(gpu.device, { limit: () => 64 + INSTANCE_BYTES })
  const previous = gpu.device.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE })
  const stages = createBinStages(gpu.device, 1)
  assert.throws(
    () => constructGpuResources(gpu.device, () => createGpuBins(gpu.device, stages, 1, 3)),
    /GPU_BUDGET_EXCEEDED/,
  )
  assert.equal(gpu.buffers.length, 2, 'refused second constructor buffer never reaches device')
  assert.equal(ledger.bytes, 64)
  assert.equal(gpu.destroyed.includes(previous), false)
  assert.equal(gpu.destroyed.includes(gpu.buffers[1]), true)
  assert.match(ledger.refusal!.message, /GPU_BUDGET_EXCEEDED/)
})

test('bins growth refusal preserves every old buffer and frees its partial replacement', () => {
  const gpu = fakeDevice()
  let ceiling = 1e9
  const ledger = installGpuDeviceLedger(gpu.device, { limit: () => ceiling })
  const previous = gpu.device.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE })
  const stages = createBinStages(gpu.device, 1)
  const made = constructGpuResources(gpu.device, () => createGpuBins(gpu.device, stages, 1, 3))
  const baseline = ledger.bytes
  const old = gpu.buffers.slice()
  // Room for the grown instance buffer and not for the commands behind it.
  ceiling = baseline + 2 * INSTANCE_BYTES
  assert.throws(
    () => constructGpuResources(gpu.device, () => createGpuBins(gpu.device, stages, 2, 3)),
    /GPU_BUDGET_EXCEEDED/,
  )
  assert.equal(gpu.buffers.length, old.length + 1)
  assert.equal(ledger.bytes, baseline)
  assert.ok(
    old.every((buffer) => !gpu.destroyed.includes(buffer)),
    'old frame resources survive',
  )
  assert.equal(gpu.destroyed.includes(gpu.buffers.at(-1)!), true)
  made.dispose()
  previous.destroy()
  assert.equal(ledger.bytes, 0)
})
