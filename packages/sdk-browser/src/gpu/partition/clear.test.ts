// The partition's counters, rest bits and slot counts are zeroed by the first dispatch of its pass
// (`clearRows`), where three `clearBuffer` cut the pass before. The shipped kernel runs over the
// threads the host dispatches: every word a reader of this frame reads holds what the clears left.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { PARTITION_SHADER } from './shader.ts'
import { partitionClearThreads } from './clearWgsl.ts'
import { PARTITION_WORKGROUP, STATE_WORDS } from './contract.ts'
import { random } from '../../page/cut/cutRuleChecks.fixture.ts'

type Ref = { get: () => number[] }

/** `clearRows` over the groups the partition dispatches for `rows` rows, on buffers holding junk. */
function cleared(rows: number, restWords: number, slotWords: number) {
  const r = random(rows),
    junk = (n: number) => Array.from({ length: n }, () => Math.floor(r() * 2 ** 32))
  const m = { state: junk(STATE_WORDS), restBits: junk(restWords), slotUsed: junk(slotWords) }
  const { clearRows } = shaderRun<{ clearRows: (id: number[]) => void }>(
    PARTITION_SHADER,
    ['clearRows'],
    { ...m, uni: { rows }, arrayLength: (p: Ref) => p.get().length },
  )
  const groups = Math.ceil(partitionClearThreads(rows, slotWords) / PARTITION_WORKGROUP)
  for (let i = 0; i < groups * PARTITION_WORKGROUP; i++) clearRows([i, 0, 0])
  return m
}

test("the pass's first dispatch zeroes every word the frame's kernels read from zero", () => {
  for (const [rows, restWords, slotWords] of [
    [1, 1, 6],
    [64, 2, 6],
    [65, 3, 30],
    [4000, 125, 300],
    [4000, 1024, 6],
    [131072, 4096, 18],
  ]) {
    const m = cleared(rows, restWords, slotWords)
    // What `clearBuffer(state, 0, STATE_WORDS * 4)` and `clearBuffer(slotUsed)` left: all zero.
    assert.ok(
      m.state.every((w) => w === 0),
      `${rows} rows: counters`,
    )
    assert.ok(
      m.slotUsed.every((w) => w === 0),
      `${rows} rows: slot counts`,
    )
    // The rest bits of the rows the frame covers: `classifyRows` sets them, the draw compaction
    // reads none past its count — at most the partition's rows (`encodeVis.ts`).
    const covered = Math.ceil(rows / 32)
    assert.ok(
      m.restBits.slice(0, covered).every((w) => w === 0),
      `${rows} rows: rest bits`,
    )
  }
})

test('the dispatch covers the longest of the three, never fewer threads', () => {
  assert.equal(partitionClearThreads(1, 6), STATE_WORDS)
  assert.equal(partitionClearThreads(4000, 300), 300)
  assert.equal(partitionClearThreads(131072, 18), 4096)
})
