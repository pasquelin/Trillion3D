import test from 'node:test'
import assert from 'node:assert/strict'
import { assertGolden } from '../../../../../math/src/golden.fixture.ts'
import { sdkWasm as wasm } from '../../../wasm/sdkWasm.fixture.ts'
import { createMultiplyLot } from './batchRuntime.ts'

// The shipped module's 4×4 product (`math_multiply_matrix4_batch`, `multiply_matrix4_one` of
// `packages/math/rust/src/matrix.rs`), whose `simd128` branch only WebAssembly runs: the crate's
// golden test runs the scalar one.

test('the multiply lot in WebAssembly returns the bits of its Rust twin on every case', async () => {
  assert.equal(wasm.math_simd(), 1, 'the shipped module carries the simd128 product')
  const lot = await createMultiplyLot(1)
  assert.ok(lot)
  try {
    assertGolden('matrix4_product', 'matrix4_product', (v) => {
      lot.a.set(v.slice(0, 16))
      lot.b.set(v.slice(16))
      lot.run()
      return lot.out.slice()
    })
  } finally {
    lot.release()
  }
})
