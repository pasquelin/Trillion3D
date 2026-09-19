// Batch math capabilities (`mathBatchState.ts`): when WebAssembly module is not playable,
// JavaScript path is announced with a reason — never a silent fallback. Node cannot
// follow file URLs with `fetch` (`geometryPageWasm.ts::ressource`): without manually supplied
// bytes, `prepareMathBatch` naturally falls back to this case, without simulation.
import test from 'node:test';
import assert from 'node:assert/strict';

test('without loaded module, capabilities announce JavaScript path and why', async () => {
  const { prepareMathBatch, mathBatchMetrics } = await import('./mathBatchState.ts');
  await prepareMathBatch('auto');
  const etat = mathBatchMetrics();
  assert.equal(etat.wasmAvailable, false);
  assert.equal(etat.wasmSimd, null);
  assert.notEqual(etat.unavailableReason, null, 'reason must never be silent');
  assert.equal(typeof etat.unavailableReason, 'string');
});
