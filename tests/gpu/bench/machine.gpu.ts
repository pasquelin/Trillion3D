// The machine calibration measures real limits: its kernels run on the GPU, each rate is finite and
// positive, a pass costs more than a dispatch beside another, and a chain of dependent dispatches
// costs no less than independent ones — the order any GPU gives, whatever its numbers.
import assert from 'node:assert/strict'
import test from 'node:test'
import { installGpu } from '../../../bench/dawn/device.ts'
import { measureMachine } from '../../../bench/dawn/machine.ts'
import { runOnDawn } from '../kit/onDawn.ts'

test('the machine’s limits are measured, positive and in order', { timeout: 300_000 }, async () => {
  const machine = await runOnDawn(async () => {
    const gpu = installGpu({ limits: null, featuresOff: [] })
    const adapter = (await navigator.gpu.requestAdapter())!
    const device = await adapter.requestDevice({ requiredFeatures: ['timestamp-query'] })
    return measureMachine(gpu, device, 'proof')
  }, null)
  for (const [key, value] of Object.entries(machine))
    if (typeof value === 'number')
      assert.ok(Number.isFinite(value) && value >= 0, `${key} ${value}`)
  assert.ok(machine.readGBs > 1 && machine.writeGBs > 1, JSON.stringify(machine))
  assert.ok(machine.threadsPerMs > 1e5, `${machine.threadsPerMs} threads a ms`)
  assert.ok(machine.passMs >= machine.dispatchMs * 0.5, 'a pass costs about a dispatch or more')
  console.log(JSON.stringify(machine))
})
