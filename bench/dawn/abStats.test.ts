import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compare } from './abStats.ts'

/** A seeded noise, so the test is the same on every run. */
const noise = (seed: number, n: number, amp: number) => {
  let s = seed
  return Array.from(
    { length: n },
    () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32 - 0.5) * amp,
  )
}
const times = (base: number, n: number, seed: number, amp = 0.2) =>
  noise(seed, n, amp).map((e) => base + e)

test('two sides of the same time are noise, whatever the rounds', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const c = compare(times(12, 8, seed), times(12, 8, seed + 100))
    assert.equal(c.verdict, 'noise', `seed ${seed}: ${c.meanMs} [${c.lowMs}, ${c.highMs}]`)
  }
})

test('a side 0.5 ms faster is a gain, 0.5 ms slower a loss', () => {
  const a = times(12, 8, 7)
  assert.equal(compare(a, times(11.5, 8, 8)).verdict, 'gain')
  assert.equal(compare(a, times(12.5, 8, 9)).verdict, 'loss')
  assert.ok(compare(a, times(11.5, 8, 8)).meanMs < 0)
})

test('a gain smaller than what matters is noise, and one round is no verdict', () => {
  assert.equal(compare(times(12, 8, 1, 0.01), times(11.98, 8, 2, 0.01), 0.05).verdict, 'noise')
  assert.throws(() => compare([12], [11]), /BENCH_AB/)
  assert.throws(() => compare([12, 12], [11]), /BENCH_AB/)
})

test('a round with no time on a side is left out, and too few rounds left is no verdict', () => {
  const a = times(12, 6, 3)
  const b = times(11.4, 6, 4)
  b[2] = Number.NaN
  const c = compare(a, b)
  assert.equal(c.rounds, 5)
  assert.equal(c.verdict, 'gain')
  assert.ok(Number.isFinite(c.lowMs) && Number.isFinite(c.highMs))
  assert.throws(() => compare([12, 12, 12], [11, Number.NaN, Number.NaN]), /BENCH_AB/)
})

test('the medians a verdict prints are those of the rounds it kept', () => {
  const c = compare([10, 10, 10, Number.NaN], [9, 9, 9, 1])
  assert.equal(c.aMs, 10)
  assert.equal(c.bMs, 9, 'the round where A gave no time is out of B’s median too')
  assert.equal(c.rounds, 3)
})
