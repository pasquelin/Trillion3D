import test from 'node:test'
import { assertGolden } from '../golden.fixture.ts'
import { fdlibmAcos, fdlibmSin } from './trig.ts'

test('fdlibmAcos returns the bits of its Rust twin on every reference case', () => {
  assertGolden('acos', 'acos', (v) => [fdlibmAcos(v[0])])
})

test('fdlibmSin returns the bits of its Rust twin on every reference case', () => {
  assertGolden('sin', 'sin', (v) => [fdlibmSin(v[0])])
})
