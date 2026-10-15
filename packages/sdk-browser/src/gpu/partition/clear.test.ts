// The partition's counters and rest bits are zeroed by the first dispatch of its pass
// (`clearRows`), where `clearBuffer` cut the pass before. The shipped kernel runs over the
// threads the host dispatches: every word a reader of this frame reads holds what the clears left.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { PARTITION_SHADER } from './shader.ts'
import { partitionClearThreads } from './clearWgsl.ts'
import { STATE_WORDS } from './contract.ts'
import { bitWords, ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { dispatchGrid, WORKGROUP_THREADS } from '../dispatch/grid.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'

/** `clearRows` over the groups the partition dispatches for `rows` rows, on buffers holding junk,
 *  in rows of `width` groups (`dispatchGrid`): a narrow width stands for a count past 65,535. */
function cleared(rows: number, restWords: number, width?: number) {
  const r = lcgRandom(rows),
    junk = (n: number) => Array.from({ length: n }, () => Math.floor(r() * 2 ** 32))
  const m = { state: junk(STATE_WORDS), restBits: junk(restWords) }
  const { clearRows } = shaderRun<{ clearRows: (id: number[], n: number[]) => void }>(
    PARTITION_SHADER,
    ['clearRows', 'flatIndex', 'ceilDiv'],
    { ...m, uni: { rows } },
  )
  const groups = ceilDiv(partitionClearThreads(rows), WORKGROUP_THREADS),
    [x, y] = dispatchGrid(groups, width)
  for (let row = 0; row < y; row++)
    for (let i = 0; i < x * WORKGROUP_THREADS; i++) clearRows([i, row, 0], [x, y, 1])
  return m
}

test("the pass's first dispatch zeroes every word the frame's kernels read from zero", () => {
  for (const [rows, restWords] of [
    [1, 1],
    [64, 2],
    [65, 3],
    [4000, 125],
    [4000, 1024],
    [131072, 4096],
  ]) {
    for (const width of [undefined, 3]) checkCleared(rows, restWords, width)
  }
})

/** Every word `clearRows` must zero is zero after the dispatch of `width`-group rows. */
function checkCleared(rows: number, restWords: number, width?: number) {
  const m = cleared(rows, restWords, width)
  assert.ok(
    m.state.every((w) => w === 0),
    `${rows} rows: counters`,
  )
  // The rest bits of the rows the frame covers: `classifyRows` sets them, the draw compaction
  // reads none past its count — at most the partition's rows (`encodeVis.ts`).
  const covered = bitWords(rows)
  assert.ok(
    m.restBits.slice(0, covered).every((w) => w === 0),
    `${rows} rows: rest bits`,
  )
}

test('the dispatch covers the longer of the two, never fewer threads', () => {
  assert.equal(partitionClearThreads(1), STATE_WORDS)
  assert.equal(partitionClearThreads(4000), 125)
  assert.equal(partitionClearThreads(131072), 4096)
})
