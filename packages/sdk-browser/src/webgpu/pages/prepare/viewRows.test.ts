// #1232: the page table is sized by what a view draws, never by the placements a scene repeats its
// pages on. A scene placed twice as many times asks the same rows, the same corners and the same
// draw words; only what its cut selects grows them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { ruleDag } from '../../../page/cut/cutRule.fixture.ts'
import { placements } from '../../../page/cut/cutRuleBackends.fixture.ts'
import { CORNER_VALUES } from '../../../gpu/partition/contract.ts'
import { CUT_ROWS, VIEW_ROWS } from '../../row/tableRows.ts'
import { createWebgpuPagesLayout } from './layout.ts'
import type { WebgpuPagesSetup } from './setup.ts'

const dag = ruleDag(8)

/** `count` placements of one primitive, every root sharing the first one's `pages`, on a pool of
 *  64 slots: each slot feeds a row per placement, so the pool alone bounds nothing. */
const layoutOf = (count: number) => {
  const roots = placements(dag, count)
  for (const root of roots) root.pages = roots[0].pages
  return createWebgpuPagesLayout({
    roots,
    bootstrap: [],
    cap: 64,
    pageBytes: 64,
  } as unknown as WebgpuPagesSetup)
}

test('the rows, corners and draw words do not grow with the placements', () => {
  const placed = Math.ceil(VIEW_ROWS / dag.pages.length) + 1
  const [some, more] = [layoutOf(placed), layoutOf(2 * placed)]
  assert.ok(some.packedPages.length > VIEW_ROWS, 'past the rows a view holds')
  assert.equal(more.packedPages.length, 2 * some.packedPages.length)
  for (const layout of [some, more]) {
    assert.equal(layout.drawSlots, CUT_ROWS, 'the rows of a view, the cut growing them')
    assert.equal(layout.rows.casterSlots, CUT_ROWS)
    assert.equal(layout.cornerPacked.length, CUT_ROWS * CORNER_VALUES)
    assert.equal(layout.drawItemWords.length, more.drawItemWords.length)
    assert.equal(layout.rows.rowPageIndex.length, CUT_ROWS)
  }
})
