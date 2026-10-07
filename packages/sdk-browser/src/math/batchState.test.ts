// Batch math capabilities (`batchState.ts`): when WebAssembly module is not playable,
// JavaScript path is announced with a reason — never a silent fallback. Node cannot
// follow file URLs with `fetch` (`./wasm/sdkWasm.ts::ressource`): without manually supplied
// bytes, `prepareMathBatch` naturally falls back to this case, without simulation.
import test from 'node:test'
import assert from 'node:assert/strict'

test('without loaded module, capabilities announce JavaScript path and why', async () => {
  const { prepareMathBatch, mathBatchMetrics } = await import('./batchState.ts')
  await prepareMathBatch('auto')
  const state = mathBatchMetrics()
  assert.equal(state.wasmAvailable, false)
  assert.equal(state.wasmSimd, null)
  assert.notEqual(state.unavailableReason, null, 'reason must never be silent')
  assert.equal(typeof state.unavailableReason, 'string')
})
