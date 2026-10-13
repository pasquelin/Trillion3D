import test from 'node:test'
import { assertGolden } from '../golden.fixture.ts'
import { srgbToLinear } from './color.ts'

// The decode raises to 2.4 through `pow`, which each platform's library rounds its own way: the
// twins agree within one step of the last bit.
test('srgbToLinear returns its Rust twin within one ulp on every reference case', () => {
  assertGolden('srgb_to_linear', 'srgb_to_linear', (v) => [srgbToLinear(v[0])], { ulps: 1 })
})
