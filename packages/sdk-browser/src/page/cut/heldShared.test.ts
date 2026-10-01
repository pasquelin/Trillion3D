// #1232: residency is the record's, and every placement of a primitive shares its records (#1235):
// the CPU cut holds one readiness per primitive, never one per placement in view, and a move named
// through any placement's rank reaches the one state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleDag } from './cutRule.fixture.ts';
import { placements } from './cutRuleBackends.fixture.ts';
import { createHeldResidency } from './held.ts';
import { postPackedBases } from '../selection/placements.ts';
import type { PageRec } from '../selection/types.ts';

test('the placements of one primitive share one readiness, moved through any of them', () => {
  const dag = ruleDag(8),
    roots = placements(dag, 50);
  for (const root of roots) root.pages = roots[0].pages;
  const placement = postPackedBases(roots),
    on = new Set<PageRec>(roots[0].pages.filter((page) => page.group === null));
  const held = createHeldResidency({ isResident: (page: PageRec) => on.has(page) }, placement);
  held.track(roots);
  const first = held.readiness(roots[0]);
  for (const root of roots) assert.equal(held.readiness(root), first, 'one state for all');
  assert.equal(held.primitives, 1);
  const bytes = held.bytes;
  // A leaf arrives, named through the last placement's rank: the shared state reads it.
  const leaf = roots[0].pages.findIndex((page) => page.group !== null);
  on.add(roots[0].pages[leaf]);
  held.moved(placement.baseOfRoot[49] + leaf, roots[0].pages[leaf]);
  held.readiness(roots[7]);
  assert.ok(held.bytes > bytes, 'the move reached the one state');
  assert.equal(held.unroutedReads, 0);
  held.endImage();
  held.endImage();
  assert.deepEqual([held.primitives, held.bytes], [0, 0], 'out of view, let go');
});
