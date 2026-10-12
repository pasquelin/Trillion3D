import test from 'node:test'
import { assertGolden } from '../golden.fixture.ts'
import { sphereUnion } from './sphere.ts'

test('sphereUnion returns the bits of its Rust twin on every reference case', () => {
  assertGolden('sphere_union', 'sphere_union', (v) => {
    const into = Float64Array.from(v.slice(0, 4))
    sphereUnion(into, 0, v.slice(4), 0)
    return into
  })
})
