import test from 'node:test'
import { assertGolden } from '../golden.fixture.ts'
import { srgbToLinear } from './color.ts'

test('srgbToLinear returns the bits of its Rust twin on every reference case', () => {
  assertGolden('srgb_to_linear', 'srgb_to_linear', (v) => [srgbToLinear(v[0])])
})
