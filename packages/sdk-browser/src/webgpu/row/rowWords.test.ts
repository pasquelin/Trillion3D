// The rows' use words are the GPU's to raise: the host sends only the rows whose occupant it changed
// or a request took, each run of neighbours once and no row between them, so the stamps the GPU left
// on the others stand; a move keeps its row's generation and counts as used now.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRowWords, ROW_PAGE, ROW_USE, ROW_USE_WORDS, ROW_WALK } from './rowWords.ts'

/** The rows each flush sends, as `[first, last]` row pairs. */
function sent(words: ReturnType<typeof createRowWords>, count: number) {
  const runs: number[][] = []
  words.flush(count, (row, data) => void runs.push([row, row + data.length / ROW_USE_WORDS - 1]))
  return runs
}

test('only the rows written are sent, each run once, nothing between', () => {
  const words = createRowWords()
  words.fit(16)
  assert.deepEqual(sent(words, 0), [], 'an empty table sends nothing')
  words.assign(2, 20, 0)
  words.assign(3, 30, 7)
  words.assign(9, 90, 7)
  assert.deepEqual(sent(words, 10), [
    [2, 3],
    [9, 9],
  ])
  assert.deepEqual(sent(words, 10), [], 'nothing written since')
})

test('a move carries its generation and its page, used now and never walked', () => {
  const words = createRowWords()
  words.fit(8)
  sent(words, 0)
  words.assign(5, 50, 0)
  const generation = words.generationOf(5)
  words.moved(5, 1, 12)
  assert.equal(words.generationOf(1), generation)
  let data = new Uint32Array(0)
  words.flush(6, (row, run) => void (row === 1 && (data = run.slice(0, ROW_USE_WORDS))))
  assert.equal(data[ROW_USE], 12)
  assert.equal(data[ROW_WALK], 0)
  assert.equal(data[ROW_PAGE], 50)
})

test('a table grown sends every live row whole, each used now', () => {
  const words = createRowWords()
  words.fit(4)
  words.assign(0, 1, 0)
  sent(words, 1)
  words.fit(64)
  words.rewriteAll(1, 9)
  const runs: Uint32Array[] = []
  words.flush(1, (_, data) => void runs.push(data))
  assert.equal(runs.length, 1)
  assert.equal(runs[0][ROW_USE], 9)
})
