// random.ts: each step against the same generator in exact BigInt arithmetic, the Rust crate's own
// cases (random_tests.rs), and the closures as the bench, the kit and the blue noise wrote them.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lcgRandom, mulberry32, xorshiftRandom } from './random.ts'
import {
  lcgFloatRandom,
  lcgFloatWord,
  lcgImulRandom,
  lcgImulWord,
  lcgMaskedRandom,
} from './seeded.fixture.ts'
import { GOLDEN_U32 } from '../constants.ts'

const W = 2n ** 32n
const MASK = W - 1n

/** One xorshift (13, 17, 5) step on a BigInt word. */
const xorshiftBig = (x: bigint) => {
  x = (x ^ (x << 13n)) & MASK
  x ^= x >> 17n
  return (x ^ (x << 5n)) & MASK
}
/** `Math.imul` as a product modulo 2³², signed read back as a BigInt word. */
const mulBig = (a: bigint, b: bigint) => (a * b) & MASK
const mulberryBig = (s: bigint) => {
  let v = mulBig(s ^ (s >> 15n), s | 1n)
  v = (v ^ ((v + mulBig(v ^ (v >> 7n), v | 61n)) & MASK)) & MASK
  return v ^ (v >> 14n)
}

test('xorshift32 steps by 13, 17, 5 on the word, as the Rust crate does', () => {
  // A draw is the stepped word over 2³², exact: times 2³² it is the word.
  const draw = xorshiftRandom(0x2545f491)
  let big = 0x2545f491n
  for (let i = 0; i < 1000; i++) {
    big = xorshiftBig(big)
    assert.equal(draw() * 2 ** 32, Number(big), `${i}`)
  }
  assert.equal(xorshiftRandom(0)(), xorshiftRandom(GOLDEN_U32)())
})

test('lcg32 is x·1664525 + 1013904223 modulo 2³²', () => {
  assert.equal(lcgRandom(957)() * 2 ** 32, (957 * 1664525 + 1013904223) % 2 ** 32)
  assert.equal(lcgRandom(0)() * 2 ** 32, 1013904223)
  const draw = lcgRandom(0xdeadbeef)
  let big = 0xdeadbeefn
  for (let i = 0; i < 1000; i++) {
    big = (big * 1664525n + 1013904223n) % W
    assert.equal(draw() * 2 ** 32, Number(big), `${i}`)
  }
})

test('mulberry32: the step and the mix, against BigInt words', () => {
  let s = 12345n
  const draw = mulberry32(12345)
  for (let i = 0; i < 1000; i++) {
    s = (s + 0x6d2b79f5n) % W
    assert.equal(draw(), Number(mulberryBig(s)) / 2 ** 32, `${i}`)
  }
})

test('the closures draw in [0, 1) as the bench, the kit and the blue noise wrote them', () => {
  // The bench's xorshiftRandom, the kit's seeded and mulberry32, written out once more here.
  const bench = (depart: number) => {
    let state = depart >>> 0 || 0x9e3779b9
    return () => {
      state = (state ^ (state << 13)) >>> 0
      state = (state ^ (state >>> 17)) >>> 0
      state = (state ^ (state << 5)) >>> 0
      return state / 4294967296
    }
  }
  const seeded = (seed: number) => {
    let state = seed >>> 0
    return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296
  }
  const prng = (seed: number) => {
    let a = seed >>> 0
    return () => {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  for (const seed of [0, 1, 7, 0x9e3779b9, 2 ** 31, 2 ** 32 - 1, -5]) {
    const pairs = [
      [xorshiftRandom(seed), bench(seed)],
      [lcgRandom(seed), seeded(seed)],
      [mulberry32(seed), prng(seed)],
    ]
    for (const [mine, theirs] of pairs)
      for (let i = 0; i < 500; i++) {
        const value = mine()
        assert.equal(value, theirs(), `${seed} ${i}`)
        assert.ok(value >= 0 && value < 1)
      }
  }
})

test('the 1103515245 streams are the closures the fixtures wrote, bit for bit', () => {
  for (const seed of [0, 1, 7, 831, 20260915, 2 ** 31 + 5, 2 ** 32 - 1]) {
    // The old bodies, each with its own state: wrapped imul, doubles (rounding past 2^53), masked.
    let imul = seed >>> 0,
      float = seed,
      masked = seed
    const imulWord = lcgImulWord(seed),
      imulRandom = lcgImulRandom(seed),
      floatWord = lcgFloatWord(seed),
      floatRandom = lcgFloatRandom(seed),
      maskedRandom = lcgMaskedRandom(seed)
    let imul2 = imul,
      float2 = float
    for (let i = 0; i < 500; i++) {
      const at = `${seed} ${i}`
      assert.equal(imulWord(), (imul = (Math.imul(imul, 1103515245) + 12345) >>> 0), at)
      assert.equal(
        imulRandom(),
        (imul2 = (Math.imul(imul2, 1103515245) + 12345) >>> 0) / 2 ** 32,
        at,
      )
      assert.equal(floatWord(), (float = (float * 1103515245 + 12345) >>> 0), at)
      assert.equal(floatRandom(), (float2 = (float2 * 1103515245 + 12345) >>> 0) / 4294967296, at)
      assert.equal(
        maskedRandom(),
        (masked = (masked * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff,
        at,
      )
    }
  }
})
