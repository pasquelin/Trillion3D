// The cut's packed lists follow what it selects, never the instances its roots could name.
// A world of thousands of placements, one in view, widens them to that one's pages.
import test from 'node:test'
import assert from 'node:assert/strict'
import { ruleDag } from './cutRule.fixture.ts'
import { AWAY, placements, stripCamera } from './cutRuleBackends.fixture.ts'
import { createHeldResidency } from './held.ts'
import { selectVisiblePages } from './cut.ts'
import { postPackedBases } from '../selection/placements.ts'

test('the packed lists widen to what the cut selects, not to every placement', () => {
  const dag = ruleDag(8),
    roots = placements(dag, 4000)
  for (const root of roots.slice(1)) root.worldBox = AWAY
  const placement = postPackedBases(roots)
  const result = selectVisiblePages(roots, stripCamera(dag), {
    pixelError: 0.1,
    viewport: [1280, 720],
    held: createHeldResidency({ isResident: () => true }, placement),
  })
  const n = dag.pages.length
  assert.ok(result.shown.length > 0 && result.shown.length <= n, 'one placement drawn')
  assert.ok(result.shownPacked.length <= 2 * n, `${result.shownPacked.length} ranks held`)
  assert.ok(result.wantedPacked.length <= 2 * n, `${result.wantedPacked.length} ranks held`)
  const ranks = Array.from(result.shownPacked.subarray(0, result.shown.length))
  assert.deepEqual(
    ranks.map((rank) => roots[0].pages[rank]),
    result.shown,
    'each rank names its record',
  )
})
