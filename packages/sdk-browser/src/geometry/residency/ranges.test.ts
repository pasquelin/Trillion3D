// The one coalescer, under the one write rule: a run spans at most 256 bytes unchanged, past
// `WRITE_CAP` runs the narrowest steps join. Checked against a plain reference on random sorted
// indices and the edges: none, one, every step joined, exactly the cap, one past it, ties at the cut.
import test from 'node:test'
import assert from 'node:assert/strict'
import { WRITE_CAP, coalesceRanges, writeRule, type RangeRule } from './ranges.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'

/** The rule spelled out: steps up to `gap` joined, past `cap` runs the narrowest joined first. */
function reference(sorted: Int32Array, gap: number, cap: number) {
  if (!sorted.length) return []
  let join = gap
  const steps: number[] = []
  for (let i = 1; i < sorted.length; i++)
    if (sorted[i] - sorted[i - 1] > join) steps.push(sorted[i] - sorted[i - 1])
  if (steps.length >= cap) join = Int32Array.from(steps).sort()[steps.length - cap]
  const out: number[][] = []
  let from = sorted[0]
  for (let i = 1; i <= sorted.length; i++) {
    if (i < sorted.length && sorted[i] - sorted[i - 1] <= join) continue
    out.push([from, sorted[i - 1]])
    if (i < sorted.length) from = sorted[i]
  }
  return out
}

const pairs = (into: Int32Array, n: number) =>
  Array.from({ length: n }, (_, r) => [into[r * 2], into[r * 2 + 1]])
function indices(next: () => number, count: number, spread: number) {
  let at = Math.floor(next() * spread) - 1
  return Int32Array.from({ length: count }, () => (at += 1 + Math.floor(next() * spread)))
}
const run = (count: number, step: number, from = 0) =>
  Int32Array.from({ length: count }, (_, i) => from + i * step)
const edges = [run(0, 1), run(1, 1), run(1, 1, 2 ** 31 - 1), run(500, 3)]
edges.push(...[WRITE_CAP, WRITE_CAP + 1].map((n) => run(n, 1000)))
edges.push(Int32Array.from({ length: 200 }, (_, i) => i * 100 + (i % 3) * 17))

test('the write rule joins as its reference, for words and for wider records', () => {
  const into = new Int32Array(2 * WRITE_CAP)
  const cases = [...edges]
  const next = lcgRandom(961)
  for (let n = 0; n < 5_000; n++)
    cases.push(indices(next, Math.floor(next() * 300), 1 + Math.floor(next() * 200)))
  const rule: RangeRule = { gap: 0, cap: 0, steps: new Int32Array(0) }
  for (const stride of [1, 4, 16])
    for (const sorted of cases) {
      writeRule(rule, stride, sorted.length)
      const r = coalesceRanges(sorted, sorted.length, into, rule)
      assert.deepEqual(
        pairs(into, r),
        reference(sorted, rule.gap, WRITE_CAP),
        `${stride}: ${sorted}`,
      )
    }
})
