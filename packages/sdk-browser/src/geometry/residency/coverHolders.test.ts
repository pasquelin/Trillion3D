// `byRank` sorts a list of pages in place, the lowest rank first, ties in their order: the same
// list as a stable sort of a copy, whatever the permutation, with none made of its own.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { PageRec } from '../selection/types.ts'
import { byRank } from './coverHolders.ts'

/** A page standing for a record: its place in the list and its rank. */
type Ranked = PageRec & { place: number; rank: number }

test('byRank orders the list in place like a stable sort of a copy', () => {
  let seed = 7
  const random = (n: number) => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
    return seed % n
  }
  for (const n of [0, 1, 2, 3, 17, 100, 300]) {
    for (let round = 0; round < 20; round++) {
      // Few distinct ranks, so ties are common and their order is what is checked.
      const pages = Array.from({ length: n }, (_, place) => ({ place, rank: random(7) }))
      const expected = pages.slice().sort((a, b) => a.rank - b.rank || a.place - b.place)
      const list = pages as unknown as Ranked[]
      assert.equal(
        byRank(list, (page) => (page as Ranked).rank),
        list,
        'the list itself comes back',
      )
      assert.deepEqual(pages, expected)
    }
  }
})
