// The levels a walk files by are the catalogue's as they stand: a source that joins with deeper
// pages raises them, and the walk after it files by the new top (`createLevelFiling`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createLevelFiling, filePage, openFiling } from './levelFiling.ts'
import type { PageRec } from '../../page/selection/selection.ts'

test('a walk lifts a capture and levels its pages by the top level it finds, never the one it was made at', () => {
  const levels = { topLevel: 2 }
  const merged = { first: 0, levels: new Int32Array(4) } as never
  const filing = createLevelFiling(
    (rec) => (rec as unknown as { key: number }).key,
    () => false,
    levels,
    merged,
  )
  openFiling(filing, 8, true)
  assert.equal(filing.lift, 2 * 2 + 2)
  filePage(filing, { key: 1, level: 1 } as unknown as PageRec)
  const before = filing.filedLevel[0]
  levels.topLevel = 9
  openFiling(filing, 8, true)
  assert.equal(filing.lift, 2 * 9 + 2, 'the lift follows the levels that rose')
  filePage(filing, { key: 1, level: 1 } as unknown as PageRec)
  assert.ok(filing.filedLevel[0] >= 0 && before >= 0)
})
