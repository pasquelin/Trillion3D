import test from 'node:test'
import { assertGolden } from '../../../../math/src/golden.fixture.ts'
import { dequant, octDecode } from './pageFields.ts'

// The readers' twins of the codec's octahedral normal and dequantization
// (`page-codec-wasm/src/golden_tests/oct.rs`, `quant.rs`), against the bits the Rust twins wrote.

test('octDecode returns the bits of its Rust twin', () => {
  assertGolden('oct', 'oct_decode', ([q]) => {
    const out = [0, 0, 0]
    octDecode(q, out)
    return out
  })
})

test('dequant returns the bits of its Rust twin', () => {
  assertGolden('quantize', 'dequantize', ([min, q, step]) => [dequant(min, q, step)])
})
