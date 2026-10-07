// The material cache's marks and its triangles' dispatch are zeroed by the first dispatch of the
// caller's pass (`shade_clear`), where two `clearBuffer` cut the pass before, and so are the slots'
// cursor and end the host's header write zeroed. The shipped kernel runs over every thread of the
// grid the host dispatches: the cache and the dispatch hold, word for word, what the clears and the
// header write left — the marks of the rows laid, the cursor, the end and x, y zeroed, nothing else.
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { wgslConstants } from '../../texture/shaderRule.fixture.ts'
import { dispatchGrid } from '../../gpu/dag/shader/gridWgsl.ts'
import { random } from '../../page/cut/cutRuleChecks.fixture.ts'
import {
  ROW_MARK_WORDS,
  ROW_RECORD_WORDS,
  SHADE_CACHE_HEADER_WORDS,
  SHADE_CACHE_ROWS_WORD,
  SHADE_CACHE_SHADER,
  SHADE_ROWS_LANES,
  TRIANGLE_WORDS,
} from '../../visibility/shader/shadeCacheWgsl.ts'

const r = random(5)
const junk = (n: number) => Array.from({ length: n }, () => Math.floor(r() * 2 ** 32))

function cache(rows: number, capacity: number) {
  const words = junk(
    SHADE_CACHE_HEADER_WORDS +
      rows * (ROW_RECORD_WORDS + ROW_MARK_WORDS) +
      capacity * TRIANGLE_WORDS,
  )
  words[SHADE_CACHE_ROWS_WORD] = rows
  return words
}

test('the first dispatch zeroes what the two clears zeroed, and nothing else', () => {
  for (const [rows, span] of [
    [1, 65535],
    [3, 65535],
    [320, 2],
    [1000, 7],
  ]) {
    const before = cache(rows, 17),
      work = [...junk(2), 1]
    // What `clearBuffer(buffer, marks * 4, rows * ROW_MARK_WORDS * 4)` and
    // `clearBuffer(work, 0, 8)` left, and the header's cursor and end, which the host's header
    // write zeroed each image.
    const marks = SHADE_CACHE_HEADER_WORDS + rows * ROW_RECORD_WORDS
    const expected = [...before].fill(0, marks, marks + rows * ROW_MARK_WORDS)
    expected[0] = expected[3] = 0
    const m = { shadeCache: [...before], work: [...work] }
    const { shade_clear } = shaderRun<{ shade_clear: (g: number[], n: number[]) => void }>(
      SHADE_CACHE_SHADER,
      ['shade_clear', 'flatIndex', 'rowMarks'],
      { ...wgslConstants(SHADE_CACHE_SHADER), ...m },
    )
    const [nx, ny] = dispatchGrid(ceilDiv(rows * ROW_MARK_WORDS, SHADE_ROWS_LANES), span)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx * SHADE_ROWS_LANES; x++) shade_clear([x, y, 0], [nx, ny, 1])
    assert.deepEqual(m.shadeCache, expected, `${rows} rows`)
    assert.deepEqual(m.work, [0, 0, 1], `${rows} rows: x and y zeroed, one deep kept`)
  }
})
