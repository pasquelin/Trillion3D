import test from 'node:test'
import { assertGolden } from '../golden.fixture.ts'
import { multiplyMatrix4 } from './matrix4.ts'

test('multiplyMatrix4 returns the bits of its Rust twin on every reference case', () => {
  const out = new Float64Array(16)
  assertGolden('matrix4_product', 'matrix4_product', (v) =>
    multiplyMatrix4(out, Float64Array.from(v.slice(0, 16)), Float64Array.from(v.slice(16))),
  )
})
