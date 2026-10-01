// #1235: an instance stores nothing per page. The layout's packed pages, the row state's ranks by
// address, the pool's copies and the DAG's page urls are counted per primitive page, whatever the
// number of placements: one more placement adds a base, never one entry per page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleDag } from '../../../page/cut/cutRule.fixture.ts';
import { placements } from '../../../page/cut/cutRuleBackends.fixture.ts';
import { packDagSelection } from '../../../gpu/dag/pack.ts';
import type { DagRoot } from '../../../gpu/dag/types.ts';
import { createWebgpuPagesLayout } from './layout.ts';
import type { WebgpuPagesSetup } from './setup.ts';

const dag = ruleDag(8);

/** `count` placements of one primitive: every root shares the first one's `pages`. */
function shared(count: number) {
  const roots = placements(dag, count);
  for (const root of roots) root.pages = roots[0].pages;
  return roots;
}

const layoutOf = (count: number) =>
  createWebgpuPagesLayout({
    roots: shared(count),
    bootstrap: [],
    cap: 64,
    pageBytes: 64,
  } as unknown as WebgpuPagesSetup);

test('the packed tables hold one entry per primitive page, whatever the placement count', () => {
  const one = layoutOf(1),
    many = layoutOf(40),
    pages = dag.pages.length;
  assert.equal(many.packedPages.length, 40 * pages, 'every instance keeps its packed rank');
  assert.equal(Array.isArray(many.packedPages), false, 'no flat list of records per instance');
  assert.deepEqual([one.rows.instances.size, many.rows.instances.size], [pages, pages]);
  assert.deepEqual([one.copies.byAddress.size, many.copies.byAddress.size], [pages, pages]);
  assert.deepEqual([one.copies.max, many.copies.max], [1, 40], 'the largest placement count');
  // A rank resolves through its placement's base to the shared record, and the address's least
  // rank names it, as the flat list did.
  const last = 39 * pages + 3;
  assert.equal(many.recordOf(last), many.selectionRoots[0].pages[3]);
  assert.equal(many.rows.pageIndexOf(many.recordOf(last)!), 3);
  const ranks: number[] = [];
  many.rows.instances.each(many.recordOf(3)!.url, (packed) => ranks.push(packed));
  assert.deepEqual(
    ranks,
    Array.from({ length: 40 }, (_, r) => r * pages + 3),
  );
});

test("the DAG's page urls are read from the shared records, none stored per page", () => {
  const packed = packDagSelection(shared(40) as unknown as DagRoot[]);
  assert.equal('pageUrls' in packed, false);
  assert.equal(packed.pageCount, 40 * dag.pages.length);
  const urls = Array.from({ length: packed.pageCount }, (_, page) => packed.pageUrlOf(page));
  assert.deepEqual(
    urls,
    Array.from({ length: 40 }, () => dag.pages.map((p) => `r0/${p.url}`)).flat(),
  );
  assert.equal(packed.pageUrlOf(packed.pageCount), undefined);
});
