import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { installGpuDeviceLedger } from './deviceLedger.ts'
import { createGpuDraw } from '../draw/factory.ts'
import { createGpuPartition } from '../partition/factory.ts'

for (const kind of ['draw', 'partition'] as const) {
  test(`${kind} initial second-buffer refusal rolls back only the partial constructor`, async () => {
    const gpu = fakeDevice()
    const firstBytes = kind === 'draw' ? 20 : 192
    const ledger = installGpuDeviceLedger(gpu.device, { limit: () => 64 + firstBytes })
    const previous = gpu.device.createBuffer({ size: 64, usage: 0 })
    const sources = {
      items: previous,
      flags: previous,
      restBits: previous,
      slotUsed: previous,
      pyramid: () => previous,
    }
    if (kind === 'draw') assert.equal(await createGpuDraw(gpu.device, 1, 1, 3), undefined)
    else await assert.rejects(createGpuPartition(gpu.device, 1, sources), /GPU_BUDGET_EXCEEDED/)
    assert.equal(gpu.buffers.length, 2, 'refused second constructor buffer never reaches device')
    assert.equal(ledger.bytes, 64)
    assert.equal(gpu.destroyed.includes(previous), false)
    assert.equal(gpu.destroyed.includes(gpu.buffers[1]), true)
    assert.match(ledger.refusal!.message, /GPU_BUDGET_EXCEEDED/)
  })

  test(`${kind} row growth refusal preserves every old buffer and frees its partial replacement`, async () => {
    const gpu = fakeDevice()
    let ceiling = 1e9
    const ledger = installGpuDeviceLedger(gpu.device, { limit: () => ceiling })
    const previous = gpu.device.createBuffer({ size: 64, usage: 0 })
    const sources = {
      items: previous,
      flags: previous,
      restBits: previous,
      slotUsed: previous,
      pyramid: () => previous,
    }
    const made =
      kind === 'draw'
        ? await createGpuDraw(gpu.device, 1, 1, 3)
        : await createGpuPartition(gpu.device, 1, sources)
    assert.ok(made)
    const baseline = ledger.bytes
    const old = gpu.buffers.slice()
    ceiling = baseline + (kind === 'draw' ? 40 : 384)
    assert.throws(() => made.grow(2, () => sources), /GPU_BUDGET_EXCEEDED/)
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
}
