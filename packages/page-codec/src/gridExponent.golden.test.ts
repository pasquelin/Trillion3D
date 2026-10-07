import test from 'node:test'
import { assertGolden } from '../../math/src/golden.fixture.ts'
import { primitiveGridExponent, tileLog2, uvGridExponent } from './gridExponent.ts'

// The TypeScript twin of a primitive's grid rules (`page-codec-wasm/src/golden_tests/grid.rs`),
// against the exponents the Rust rules wrote: hostile spans, the rules' documented cases, a sweep.

/** The finest grid of a span with no finite logarithm, as `finestExponent` documents it: a NaN or
 *  a negative one 2^-23, a zero the finest, an infinite one the coarsest. */
const finestOfNoLogarithm = (span: number) => (span === 0 ? -64 : span === Infinity ? 64 : -23)

// `finest_exponent` is private to its module, reached through the rule that calls it: a blended
// primitive's grid is it for a positive finite span; the others hold its documented values.
test('finestExponent returns the finest grid of its Rust twin', () => {
  assertGolden('grid', 'finest_exponent', ([span]) => [
    span > 0 && span < Infinity
      ? primitiveGridExponent(span, null, true, 0)
      : finestOfNoLogarithm(span),
  ])
})

test('tileLog2 returns the exponents of its Rust twin', () => {
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
