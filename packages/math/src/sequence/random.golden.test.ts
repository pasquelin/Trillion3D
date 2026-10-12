import test from 'node:test'
import { assertGolden } from '../golden.fixture.ts'
import { lcgRandom, xorshiftRandom } from './random.ts'

// A draw is the next state over 2³², exact in a double: the word is the draw times 2³².
const WORD_RANGE = 4294967296

test('xorshiftRandom steps the state as its Rust twin on every reference case', () => {
  assertGolden('xorshift32', 'xorshift32', (v) => [xorshiftRandom(v[0])() * WORD_RANGE])
})

test('lcgRandom steps the state as its Rust twin on every reference case', () => {
  assertGolden('lcg32', 'lcg32', (v) => [lcgRandom(v[0])() * WORD_RANGE])
})
