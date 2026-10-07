import test from 'node:test'
import { assertGolden } from '../golden.fixture.ts'
import { hypot2, hypot3, hypot4 } from './hypot.ts'

test('hypot2, hypot3 and hypot4 return the bits of their Rust twin on every reference case', () => {
  assertGolden('hypot', 'hypot', (v) => [
    v.length === 2
      ? hypot2(v[0], v[1])
      : v.length === 3
        ? hypot3(v[0], v[1], v[2])
        : hypot4(v[0], v[1], v[2], v[3]),
  ])
})
