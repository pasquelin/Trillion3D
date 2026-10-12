import test from 'node:test'
import { assertGolden } from '../golden.fixture.ts'
import { mipSize } from './integers.ts'

test('mipSize returns its Rust twin’s side on every reference case', () => {
  assertGolden('mip_size', 'mip_size', (v) => [mipSize(v[0], v[1])])
})
