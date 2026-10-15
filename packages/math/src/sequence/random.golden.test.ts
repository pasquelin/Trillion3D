import test from 'node:test'
import { assertGolden } from '../golden.fixture.ts'
import { lcgRandom } from './random.ts'
import { WORD_RANGE } from '../constants.ts'

// A draw is the next state over 2³², exact in a double: the word is the draw times `WORD_RANGE`.

test('lcgRandom steps the state as its Rust twin on every reference case', () => {
  assertGolden('lcg32', 'lcg32', (v) => [lcgRandom(v[0])() * WORD_RANGE])
})
