import test from 'node:test'
import { assertGolden } from '../golden.fixture.ts'
import { normalizeQuaternion } from './quaternion.ts'

test('normalizeQuaternion returns the bits of its Rust twin on every reference case', () => {
  assertGolden('quaternion_normalize', 'quaternion_normalize', (v) =>
    normalizeQuaternion(Float64Array.from(v)),
  )
})
