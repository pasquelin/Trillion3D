// random.ts: each step against the same generator in exact BigInt arithmetic, and the closure as
// the kit wrote it.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lcgRandom } from './random.ts'
import {
  lcgFloatRandom,
  lcgFloatWord,
  lcgImulRandom,
  lcgImulWord,
  lcgMaskedRandom,
} from './seeded.fixture.ts'

const W = 2n ** 32n

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

test('the closure draws in [0, 1) as the kit wrote it', () => {
  const seeded = (seed: number) => {
    let state = seed >>> 0
    return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296
  }
  for (const seed of [0, 1, 7, 0x9e3779b9, 2 ** 31, 2 ** 32 - 1, -5]) {
    const mine = lcgRandom(seed),
      theirs = seeded(seed)
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
