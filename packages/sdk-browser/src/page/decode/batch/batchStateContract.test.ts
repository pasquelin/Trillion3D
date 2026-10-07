// Second scenario for batch math capabilities: module instantiates but its compute
// contract is not as expected. Separated from `batchState.test.ts` because `prepareSdkWasm`
// caches its decision process-wide — single load scenario per file, like `../../../wasm/sdkWasm.test.ts`
// already does for the decoder.
import test from 'node:test'
import assert from 'node:assert/strict'

test('unknown compute contract leaves everything on JavaScript with published reason', async () => {
  const instantiateOriginal = WebAssembly.instantiate
  const fetchOriginal = globalThis.fetch
  // `ressource()` (`../../../wasm/sdkWasm.ts`) fetches bytes via `fetch`: without simulated response, call
  // fails before reaching `WebAssembly.instantiate`, as shown in `batchState.test.ts`.
  // @ts-expect-error: minimal response, sufficient to pass `reponse.ok` then `arrayBuffer()`.
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) })
  // @ts-expect-error: simulates a module whose compute ABI changed version.
  WebAssembly.instantiate = async () => ({
    instance: {
      exports: {
        math_contract: () => 2, // loader expects WASM_ARENA_CONTRACT (1)
        math_simd: () => 1,
      },
    },
  })
  try {
    const { prepareMathBatch, mathBatchMetrics } = await import('./batchState.ts')
    await prepareMathBatch('auto')
    const state = mathBatchMetrics()
    assert.equal(state.wasmAvailable, false)
    assert.equal(state.wasmSimd, null)
    assert.match(state.unavailableReason ?? '', /computation contract/)
  } finally {
    WebAssembly.instantiate = instantiateOriginal
    globalThis.fetch = fetchOriginal
  }
})
