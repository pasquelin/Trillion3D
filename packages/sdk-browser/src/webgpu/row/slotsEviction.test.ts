// The rows' victims follow each placement's own use: of two placements of one primitive, the row
// of a group-mate a drawn page needs — outside the frustum, drawn by none — is in use, the row of
// the same content in the placement that draws nothing is a victim. A victim is taken by its page
// wherever a move put its row, and a page that took its row after the queue's cut never is.
import test from 'node:test'
import assert from 'node:assert/strict'
import { structureIndex } from '../../page/selection/structure.ts'
import { sortPool } from '../../gpu/pool/sort.fixture.ts'
import { poolRank } from '../../gpu/pool/rank.fixture.ts'
import { ROW_BURST } from '../../gpu/dag/readoutWords.ts'
import { closeRows } from './rowClosure.fixture.ts'
import { createRowOrder } from './rowOrder.ts'
import { createRowWords, ROW_PAGE, ROW_USE, ROW_USE_WORDS } from './rowWords.ts'
import { ROW_IN_USE } from './rowEvictSortWgsl.ts'

/** One primitive: pages 0 and 1 a group, its output page 2 the root nothing replaces. */
const structure = structureIndex(
  {
    version: 1,
    roots: [2],
    groups: [{ level: 0, error: 1, sphere: [0, 0, 0, 1], children: [0, 1], outputs: [2] }],
  } as never,
  3,
)!

/** Placements A (packed pages 0 to 2) and B (3 to 5) of it, each page holding the row of its rank,
 *  the host's words sent to the GPU's; the GPU's cut at `clock` over `seeds`. */
function scene() {
  const placements = [
    { pageBase: 0, structure },
    { pageBase: 3, structure },
  ]
  const rowOf = new Map<number, number>(),
    words = createRowWords(),
    use = new Uint32Array(8 * ROW_USE_WORDS)
  words.fit(8)
  const place = (row: number, page: number) => {
    rowOf.set(page, row)
    words.assign(row, page, 0)
  }
  for (let page = 0; page < 6; page++) place(page, page)
  const order = createRowOrder((page) => rowOf.get(page) ?? -1, words)
  /** The GPU's cut at `clock`: the host's writes sent, the seeds' closure stamped, the rows ranked
   *  and the queue followed. */
  const cut = (clock: number, seeds: { page: number; placement: number }[], rows: number) => {
    words.flush(rows, (row, data) => use.set(data, row * ROW_USE_WORDS))
    const stamped = seeds.map((seed) => ({ ...seed, value: clock }))
    closeRows(stamped, placements, (page) => rowOf.get(page) ?? -1, use)
    const age = (j: number) => clock - Math.min(use[j * ROW_USE_WORDS + ROW_USE], clock)
    const ranked = sortPool(rows, (j) => poolRank(age(j), 0, ROW_IN_USE), ROW_BURST)
    const pages = Uint32Array.from(ranked.queue, (j) => use[j * ROW_USE_WORDS + ROW_PAGE])
    order.follow(pages, ranked.total, clock)
    return [...pages]
  }
  return { rowOf, words, order, place, cut }
}

test('the row of a drawn page’s group-mate is in use, the same content’s of another placement not', () => {
  const s = scene()
  s.order.noteFrame(100)
  // A draws page 0; page 1, its group-mate, is outside the frustum; B draws nothing.
  const queue = s.cut(100, [{ page: 0, placement: 0 }], 6)
  assert.ok(!queue.includes(1), 'A’s group-mate holds its row')
  assert.ok(!queue.includes(2), 'so does the group above it')
  assert.deepEqual(queue, [3, 4, 5], 'B’s rows, of the same content, go')
})

test('a victim is taken by its page wherever a move put its row; one placed since never', () => {
  const s = scene()
  s.order.noteFrame(100)
  s.cut(100, [{ page: 0, placement: 0 }], 6)
  // After the cut: page 3's row is given back and taken again by page 3 itself — a new arrival —,
  // and page 4's row moves to rank 6.
  s.rowOf.delete(3)
  s.place(7, 3)
  s.words.moved(4, 6, 101)
  s.rowOf.set(4, 6)
  assert.equal(s.order.victim(), 4, 'page 3 took its row after the cut: skipped; 4 where it moved')
  assert.equal(s.order.victim(), 5)
  assert.equal(s.order.victim(), undefined)
})
