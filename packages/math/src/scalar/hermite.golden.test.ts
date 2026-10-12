import test from 'node:test'
import { assertGolden } from '../golden.fixture.ts'
import { hermiteBasis } from './hermite.ts'

test('hermiteBasis returns the bits of its Rust twin on every reference case', () => {
  assertGolden('hermite_basis', 'hermite_basis', (v) => hermiteBasis(new Float64Array(4), v[0]))
})
