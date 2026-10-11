import test from 'node:test'
import { assertGolden } from '../../../../math/src/golden.fixture.ts'
import { sdkWasm as module } from '../../wasm/sdkWasm.fixture.ts'

// The grid rules of a primitive as the SDK module exports them to the run-time cut
// (`page-codec-wasm/src/wasm_encode.rs`), against the exponents the Rust rules wrote
// (`page-codec-wasm/src/golden_tests/grid.rs`): hostile spans, the rules' documented cases, a sweep.

/** The finest grid of a span with no finite logarithm, as `finest_exponent` documents it: a NaN or
 *  a negative one 2^-23, a zero the finest, an infinite one the coarsest. */
const finestOfNoLogarithm = (span: number) => (span === 0 ? -64 : span === Infinity ? 64 : -23)

// `finest_exponent` is private to its module, reached through the rule that calls it: a blended
// primitive's grid is it for a positive finite span; the others hold its documented values.
test('the module returns the finest grid of its Rust rule', () => {
  assertGolden('grid', 'finest_exponent', ([span]) => [
    span > 0 && span < Infinity
      ? module.grid_position_exponent(span, NaN, 1, 0)
      : finestOfNoLogarithm(span),
  ])
})

test('the module returns the tile of its Rust rule', () => {
  assertGolden('grid', 'tile_log2', ([hasScale, scale]) => [
    module.grid_tile_log2(hasScale ? scale : NaN),
  ])
})

test('the module returns the position grid of its Rust rule', () => {
  assertGolden('grid', 'primitive_grid_exponent', ([extent, hasError, error, blended, tile]) => [
    module.grid_position_exponent(extent, hasError ? error : NaN, blended, tile),
  ])
})

test('the module returns the texture grid of its Rust rule', () => {
  assertGolden('grid', 'uv_grid_exponent', ([span, blended]) => [
    module.grid_uv_exponent(span, blended),
  ])
})
