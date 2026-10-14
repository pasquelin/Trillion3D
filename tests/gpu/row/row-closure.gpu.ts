// R1 (#1527): the rows' closure and their victim sort on Dawn, after the shipped cut. On the cut-rule
// DAG placed 1 to 4096 times — one primitive shared by every placement, the strip camera seeing the
// first, its frustum cutting groups —, the use words the shipped closure raises from the cut's own
// lists are word for word those its contract raises (`rowClosure.fixture.ts`): each placement's own
// rows, through its groups, the gate per placement and group. The victim queue is the same on two
// runs over the same words, and the pool sort's contract (`sort.fixture.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { closureScene, CUT_FRAME, runRowClosure } from './rowClosureRun.ts'
import { closeRows } from '../../../packages/sdk-browser/src/webgpu/row/rowClosure.fixture.ts'
import {
  ROW_PAGE,
  ROW_USE,
  ROW_USE_WORDS,
} from '../../../packages/sdk-browser/src/webgpu/row/rowWords.ts'
import { ROW_IN_USE } from '../../../packages/sdk-browser/src/webgpu/row/rowEvictSortWgsl.ts'
import { sortPool } from '../../../packages/sdk-browser/src/gpu/pool/sort.fixture.ts'
import { poolRank } from '../../../packages/sdk-browser/src/gpu/pool/rank.fixture.ts'
import { SELECTION_HEADER_WORDS } from '../../../packages/sdk-browser/src/gpu/dag/readoutWords.ts'

/** The clock the queue is ranked at: the cut's rows in use, the others idle. */
const CLOCK = CUT_FRAME + 1

for (const copies of [1, 64, 4096]) {
  test(`the closure's words are its contract's, and the queue stable, over ${copies} placements`, async () => {
    const scene = closureScene(copies)
    const { reading, use, queues, burst } = await runRowClosure(scene, CLOCK)
    assert.ok(reading.drawn.length > 4 && reading.requests.length > 0, 'the cut draws and asks')
    const seeds = [...reading.drawn, ...reading.requests].map((page) => ({
      page,
      placement: scene.placementOf(page),
      value: CUT_FRAME,
    }))
    const contract = scene.initial.slice()
    closeRows(seeds, scene.placements, scene.rowOf, contract)
    assert.ok(
      contract.some((word) => word === CUT_FRAME),
      'the cut stamps rows',
    )
    assert.deepEqual(use, contract, 'the use and walk words, word for word')
    const age = (j: number) => CLOCK - Math.min(use[j * ROW_USE_WORDS + ROW_USE], CLOCK)
    const ranked = sortPool(scene.count, (j) => poolRank(age(j), 0, ROW_IN_USE), burst)
    assert.deepEqual(queues[1], queues[0], 'two runs, the same queue')
    const [count, total, clock] = queues[0]
    assert.deepEqual([count, total, clock], [ranked.queue.length, ranked.total, CLOCK + 1])
    assert.ok(total > 0, 'rows no cut used are ranked')
    const pages = Array.from(
      queues[0].subarray(SELECTION_HEADER_WORDS, SELECTION_HEADER_WORDS + count),
    )
    assert.deepEqual(
      pages,
      ranked.queue.map((j) => contract[j * ROW_USE_WORDS + ROW_PAGE]),
      'its pages, the contract’s',
    )
  })
}
