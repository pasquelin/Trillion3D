import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertGolden } from '../../../../../math/src/golden.fixture.ts'
import { prepareSdkWasm } from '../../../wasm/sdkWasm.ts'
import { prepareMathBatch } from './batchState.ts'
import { createMultiplyLot } from './batchRuntime.ts'

// The shipped module's 4×4 product (`math_multiply_matrix4_batch`, `multiply_matrix4_one` of
// `packages/math/rust/src/matrix.rs`), whose `simd128` branch only WebAssembly runs: the crate's
// golden test runs the scalar one. Node cannot fetch the module by its URL; the test hands it the bytes.
const wasm = await prepareSdkWasm(
  readFileSync(join(import.meta.dirname, '../../../wasm/kernels.wasm')),
)

test('multiplyMatrix4Batch in WebAssembly returns the bits of its Rust twin on every case', async () => {
  assert.equal(wasm?.math_simd(), 1, 'the shipped module carries the simd128 product')
  await prepareMathBatch('wasm')
  const lot = await createMultiplyLot(1)
  try {
    assertGolden('matrix4_product', 'matrix4_product', (v) => {
      lot.a.set(v.slice(0, 16))
      lot.b.set(v.slice(16))
      assert.equal(lot.run(), 'wasm')
      return lot.out.slice()
    })
  } finally {
    lot.release()
  }
})
