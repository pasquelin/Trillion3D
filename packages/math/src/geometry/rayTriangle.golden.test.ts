import test from 'node:test'
import { assertGolden } from '../golden.fixture.ts'
import { rayTriangle } from './rayTriangle.ts'

test('the ray–triangle hit is the Rust twin’s, bit for bit', () => {
  assertGolden('ray_triangle', 'ray_triangle', (v) => {
    const far = v[16]
    const distance = rayTriangle(v.slice(0, 3), v.slice(3, 6), v.slice(6, 15), 0, v[15], far)
    return Object.is(distance, far) ? [] : [distance]
  })
})
