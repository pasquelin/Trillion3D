import assert from 'node:assert/strict'
import { test } from 'node:test'
import { VSM_MIPS } from '../constants.ts'
import { clipmapStatsLines, readClipmapStats } from './clipmapStats.ts'

/** The words of `vsmMappedRects` for maps whose first mip holds `rects`, the other mips empty. */
const wordsOf = (rects: number[][]) => {
  const words = new Uint32Array(rects.length * VSM_MIPS * 4)
  rects.forEach((rect, level) => words.set(rect, level * VSM_MIPS * 4))
  return words
}

test('a level with pages prints its rect, size and area; an empty one only its rect; the total sums the areas', () => {
  const empty = [0xffffffff, 0xffffffff, 0, 0]
  const levels = readClipmapStats(wordsOf([[2, 3, 4, 7], empty, [0, 0, 0, 0]]), 3)
  assert.deepEqual(clipmapStatsLines(levels), [
    'Allocated Page Rects',
    '2 3 4 7 3 5 15',
    '4294967295 4294967295 0 0',
    '0 0 0 0 1 1 1',
    'Total Area 16',
  ])
})
