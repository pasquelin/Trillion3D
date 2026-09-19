// Second scenario for batch math capabilities: module instantiates but its compute
// contract is not as expected. Separated from `mathBatchState.test.ts` because `prepareSdkWasm`
// caches its decision process-wide — single load scenario per file, like `geometryPageWasm.test.ts`
// already does for the decoder.
import test from 'node:test';
import assert from 'node:assert/strict';

test('unknown compute contract leaves everything on JavaScript with published reason', async () => {
  const instantiateOriginal = WebAssembly.instantiate;
  const fetchOriginal = globalThis.fetch;
  // `ressource()` (`geometryPageWasm.ts`) fetches bytes via `fetch`: without simulated response, call
  // fails before reaching `WebAssembly.instantiate`, as shown in `mathBatchState.test.ts`.
  // @ts-expect-error: minimal response, sufficient to pass `reponse.ok` then `arrayBuffer()`.
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
  // @ts-expect-error: simulates a module whose compute ABI changed version.
  WebAssembly.instantiate = async () => ({
    instance: {
      exports: {
        math_contract: () => 2, // loader expects WASM_ARENA_CONTRACT (1)
        math_simd: () => 1,
      },
    },
  });
  try {
    const { prepareMathBatch, mathBatchMetrics } = await import('./mathBatchState.ts');
    await prepareMathBatch('auto');
    const etat = mathBatchMetrics();
    assert.equal(etat.wasmAvailable, false);
    assert.equal(etat.wasmSimd, null);
    assert.match(etat.unavailableReason ?? '', /computation contract/);
  } finally {
    WebAssembly.instantiate = instantiateOriginal;
    globalThis.fetch = fetchOriginal;
  }
});
