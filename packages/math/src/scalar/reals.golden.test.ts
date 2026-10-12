import test from 'node:test'
import { assertGolden } from '../golden.fixture.ts'
import { lerp, mix } from './reals.ts'

test('lerp and mix return the bits of their Rust twins on every reference case', () => {
  assertGolden('interpolation', 'lerp', (v) => [lerp(v[0], v[1], v[2])])
  assertGolden('interpolation', 'mix', (v) => [mix(v[0], v[1], v[2])])
})
