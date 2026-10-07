import test from 'node:test'
import { assertGolden } from '../../math/src/golden.fixture.ts'
import { dequant, octDecode, octEncode, quantize } from './pageGrids.ts'
import { positionError } from './geometryPage.ts'

// The encoder's and the readers' twins of the codec's octahedral normal and quantization
// (`page-codec-wasm/src/golden_tests/oct.rs`, `quant.rs`), against the bits the Rust twins wrote.

const decoded = (q: number) => {
  const out = [0, 0, 0]
  octDecode(q, out)
  return out
}

test('octEncode, octDecode and the two in turn return the bits of their Rust twins', () => {
  assertGolden('oct', 'oct_encode', (v) => [octEncode(v[0], v[1], v[2])])
  assertGolden('oct', 'oct_decode', (v) => decoded(v[0]))
  assertGolden('oct', 'oct_round_trip', (v) => decoded(octEncode(v[0], v[1], v[2])))
})

test('quantize writes the minimum, widths and offsets of its Rust twin, and refuses what it refuses', () => {
  assertGolden('quantize', 'quantize', ([exponent, ...values]) => {
    try {
      const { min, bits, cells } = quantize(Float32Array.from(values), 3, exponent)
      return [...min, ...bits, ...cells]
    } catch {
      return []
    }
  })
})

test('dequant returns the bits of its Rust twin', () => {
  assertGolden('quantize', 'dequantize', ([min, q, step]) => [dequant(min, q, step)])
})

test("the page's error bound is the one its Rust twin writes", () => {
  assertGolden('quantize', 'quantization_error', ([exponent, ...rest]) => {
    const vertices = (rest.length - 3) / 6,
      values: number[] = [],
      cells: number[] = []
    for (let i = 0; i < vertices; i++) {
      values.push(...rest.slice(3 + i * 6, 6 + i * 6))
      cells.push(...rest.slice(6 + i * 6, 9 + i * 6))
    }
    const grid = { min: rest.slice(0, 3), exponent, bits: [0, 0, 0], cells }
    const original = Array.from({ length: vertices }, (_, i) => i)
    return [positionError(grid, { itemSize: 3, array: Float32Array.from(values) }, original)]
  })
})
