import test from 'node:test'
import { assertGolden } from '../golden.fixture.ts'
import { normalizeVector3 } from './vector.ts'

test('normalizeVector3 returns the bits of its Rust twin on every reference case', () => {
  assertGolden('vec3_unit', 'vec3_unit', (v) => {
    const out = Float64Array.from(v)
    normalizeVector3(out)
    return out
  })
})
