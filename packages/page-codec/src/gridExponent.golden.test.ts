import test from 'node:test'
import { assertGolden } from '../../math/src/golden.fixture.ts'
import { finestExponent, primitiveGridExponent, tileLog2, uvGridExponent } from './gridExponent.ts'

// The TypeScript twin of a primitive's grid rules (`page-codec-wasm/src/golden_tests/grid.rs`),
// against the exponents the Rust rules wrote: hostile spans, the rules' documented cases, a sweep.

test('finestExponent and tileLog2 return the exponents of their Rust twins', () => {
  assertGolden('grid', 'finest_exponent', ([span]) => [finestExponent(span)])
  assertGolden('grid', 'tile_log2', ([hasScale, scale]) => [tileLog2(hasScale ? scale : null)])
})

test('primitiveGridExponent returns the position grid of its Rust twin', () => {
  assertGolden('grid', 'primitive_grid_exponent', ([extent, hasError, error, blended, tile]) => [
    primitiveGridExponent(extent, hasError ? error : null, blended === 1, tile),
  ])
})

test('uvGridExponent returns the texture grid of its Rust twin', () => {
  assertGolden('grid', 'uv_grid_exponent', ([span, blended]) => [
    uvGridExponent(span, blended === 1),
  ])
})
