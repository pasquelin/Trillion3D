// A growth of the float pool moves the deformation block after the wider vertices (`wholePool.ts`,
// `SessionDeformation.place`): every row that reads a record or a float-pool block, and every
// transparent span that reads a block, is pointed at the new place; a row with no results is left as it is.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deformOutputWord, followPooledBlocks } from './outputs.ts'
import { ROW_WORDS } from '../visibility/types.ts'
import type { HostAttributes } from '../host/resources.ts'
import type { PageRec } from '../page/selection/selection.ts'
import { PAGE_INFO } from '../visibility/pageInfo.ts'

/** Four rows — a float-pool block, a page's own results, the block again, a row with none —, a placement each. */
function rig() {
  const block = { from: 100, count: 9, pool: { attributes: {} as HostAttributes } },
    own = { from: 12, count: 3 }
  const outputs = [block, own, block, undefined]
  const recs = outputs.map(() => ({}) as PageRec)
  const words = ROW_WORDS,
    ints = new Uint32Array(4 * words),
    marked: number[] = []
  ints[ROW_WORDS + PAGE_INFO.at.deformOutput] = 77
  const rows = {
    pageTableInts: ints,
    packedRecs: recs,
    packedPageIndex: Int32Array.from([0, 1, 2, 3]),
    markRowWords: (r: number) => marked.push(r),
  }
  const spans = new Uint32Array(12),
    dirtySpans = new Set<number>()
  spans.set([5, 6, 0, 0, 0, 0, 0, 0, 9, 0, 0, 0]) // entry 0 drawn, entry 2 holds no corner
  // Placement 1 (the tail's page) holds a record at float 40 of the block, which starts at `base`.
  const deformation = {
    base: 500,
    rowWord(rank: number) {
      return rank === 1 ? this.base + 40 : 0
    },
  }
  const rt = {
    layout: {
      rows,
      deformationOutputOf: (page: number) => outputs[page],
      placement: { baseOfRoot: Int32Array.of(0, 1, 2, 3), packedCount: 4 },
    },
    blendState: { table: { pageOfEntry: Int32Array.from([0, 1, 2]), spans }, dirtySpans },
    vis: { deformation },
  } as unknown as Parameters<typeof followPooledBlocks>[0]
  ints[words + PAGE_INFO.at.deform] = deformation.rowWord(1)
  return { block, own, ints, words, marked, spans, dirtySpans, deformation, rt }
}

test('the rows and spans of a moved float-pool block follow it; a tail stays', () => {
  const { block, own, ints, words, marked, spans, dirtySpans, rt } = rig()
  block.from = 4000
  followPooledBlocks(rt)
  const moved = deformOutputWord(block)
  assert.deepEqual(marked, [0, 1, 2])
  assert.equal(ints[PAGE_INFO.at.deformOutput], moved)
  assert.equal(ints[2 * words + PAGE_INFO.at.deformOutput], moved)
  assert.equal(ints[words + PAGE_INFO.at.deformOutput], deformOutputWord(own))
  assert.equal(ints[3 * words + PAGE_INFO.at.deformOutput], 0, 'a row with none names none')
  assert.deepEqual([spans[2], spans[10], [...dirtySpans]], [moved, 0, [0]])
})

test("a row's record word follows the moved records; a row with none, or unmoved, is not written", () => {
  const { ints, marked, deformation, rt } = rig()
  followPooledBlocks(rt)
  assert.deepEqual(marked, [0, 1, 2], 'records in place: only the rows with results are written')
  marked.length = 0
  deformation.base = 9000
  followPooledBlocks(rt)
  assert.equal(ints[ROW_WORDS + PAGE_INFO.at.deform], 9040, 'the record read at its new place')
  assert.deepEqual([ints[PAGE_INFO.at.deform], ints[2 * ROW_WORDS + PAGE_INFO.at.deform]], [0, 0])
  assert.deepEqual(marked, [0, 1, 2])
})
