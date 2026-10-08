import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { BenchPass } from './benchPasses.ts'
import { readPasses } from './passSpans.ts'
import { emptyWork } from './passWorkHooks.ts'
import { spread } from './summary.ts'
import { timerDoubts } from './trust.ts'

const pass = (name: string, median: number, extra: Partial<BenchPass> = {}) =>
  ({
    name,
    median,
    mean: median,
    max: median,
    lost: 0,
    empty: 0,
    unknown: 0,
    ...extra,
  }) as BenchPass
const frame = (...values: number[]) => spread(values)

test('a coherent segment raises no doubt', () => {
  const doubts = timerDoubts({
    passes: [pass('a', 3), pass('b', 2)],
    frame: frame(5, 5.1, 4.9),
    engineFrame: frame(5.05),
  })
  assert.deepEqual(doubts, [])
})

test('a lost timer and an indirect pass are doubted; a pass that ran in no time is not', () => {
  const doubts = timerDoubts({
    passes: [
      pass('lost', 0, { lost: 4 }),
      pass('empty', 0, { empty: 9 }),
      pass('indirect', 0, { unknown: 2 }),
      pass('work', 5),
    ],
    frame: frame(5, 5, 5),
    engineFrame: null,
  })
  assert.match(doubts[0], /timer lost: "lost"/)
  assert.match(doubts[1], /unknown: "indirect"/)
  assert.equal(doubts.length, 2, 'a pass that encoded nothing is a true zero, never a doubt')
})

test('passes whose sum is not the frame, or an engine timer that disagrees, are doubted', () => {
  const doubts = timerDoubts({
    passes: [pass('a', 3), pass('b', 1)],
    frame: frame(6, 6, 6),
    engineFrame: frame(10),
  })
  assert.ok(doubts.some((d) => /passes sum 4\.00 ms on average/.test(d)))
  assert.ok(doubts.some((d) => /engine's 10\.00/.test(d)))
})

test('stamps with a pass the driver skipped read as lost, one of no length as empty', () => {
  const ns = (ms: number) => BigInt(Math.round(ms * 1e6))
  const stamps = [ns(10), ns(12), 0n, 0n, ns(13), ns(13), ns(15), ns(18)]
  const frameGpu = readPasses(
    stamps,
    ['a', 'skipped', 'empty', 'late'].map((label, k) => ({
      label,
      kind: 'compute' as const,
      at: 2 * k,
      ...emptyWork(),
      calls: label === 'empty' ? 0 : 1,
    })),
    true,
  )
  assert.deepEqual(
    frameGpu.passes.map((p) => p.state),
    ['ok', 'lost', 'empty', 'ok'],
  )
})

test("an injected wait is the pass-after-it's gap, not its work", () => {
  const ns = (ms: number) => BigInt(Math.round(ms * 1e6))
  // b begins 0.8 ms after a ended: the GPU idled; b's own work is its 1 ms span.
  const stamps = [ns(10), ns(12), ns(12.8), ns(13.8)]
  const { passes, gapMs, unionMs } = readPasses(
    stamps,
    ['a', 'b'].map((label, k) => ({
      label,
      kind: 'compute' as const,
      at: 2 * k,
      ...emptyWork(),
      calls: 1,
    })),
    true,
  )
  assert.ok(Math.abs(passes[1].gapMs - 0.8) < 1e-9)
  assert.ok(Math.abs(passes[1].ms - 1) < 1e-9)
  assert.ok(Math.abs(gapMs - 0.8) < 1e-9)
  assert.ok(Math.abs(unionMs - 3) < 1e-9)
})

test('a spread names the dispersion of frames, a slow outlier included', () => {
  const slow = spread([1, 1, 1, 9, 1, 1, 9, 1])!
  assert.ok(slow.iqr >= 0 && slow.std > 3 && slow.p95 === 9)
})
