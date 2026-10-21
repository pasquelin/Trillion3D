import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { installGpuDeviceLedger } from './deviceLedger.ts'
import { createGpuDraw } from '../../visibility/draw/factory.ts'
import { DRAW_ITEM_U32 } from '../../visibility/draw/contract.ts'

// The compact's first buffer, for one row: the items it holds (`createGpuDrawBuffers`).
const ROW_BYTES = DRAW_ITEM_U32 * 4

test('draw initial second-buffer refusal rolls back only the partial constructor', async () => {
  const gpu = fakeDevice()
  const ledger = installGpuDeviceLedger(gpu.device, { limit: () => 64 + ROW_BYTES })
  const previous = gpu.device.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE })
  assert.equal(await createGpuDraw(gpu.device, 1, 1, 3), undefined)
  assert.equal(gpu.buffers.length, 2, 'refused second constructor buffer never reaches device')
  assert.equal(ledger.bytes, 64)
  assert.equal(gpu.destroyed.includes(previous), false)
  assert.equal(gpu.destroyed.includes(gpu.buffers[1]), true)
  assert.match(ledger.refusal!.message, /GPU_BUDGET_EXCEEDED/)
})

test('draw row growth refusal preserves every old buffer and frees its partial replacement', async () => {
  const gpu = fakeDevice()
  let ceiling = 1e9
  const ledger = installGpuDeviceLedger(gpu.device, { limit: () => ceiling })
  const previous = gpu.device.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE })
  const made = await createGpuDraw(gpu.device, 1, 1, 3)
  assert.ok(made)
  const baseline = ledger.bytes
  const old = gpu.buffers.slice()
  ceiling = baseline + 2 * ROW_BYTES
  assert.throws(() => made.grow(2), /GPU_BUDGET_EXCEEDED/)
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
