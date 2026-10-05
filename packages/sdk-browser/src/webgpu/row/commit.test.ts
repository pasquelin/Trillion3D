// Lot F, F4 and F5: F4 (commit.ts) no longer rewrites the page, offset, epoch and inverse
// rank of a row that `sourceRowOf` made exact; F5 (state.ts) gives a catalogue page's rank as the
// oracle's hash table does — read by pool address since #1235, one record serving every placement.
// The oracles are the implementations from before lot F, copied as-is into
// `bench/oracles/browser/drawable-rows.ts`. The comparison is on the full array state after a
// sequence of images, not on a single image: that is where reused rows show.
//
// What this comparison CANNOT prove: what lot F did not change. `sourceRowOf` is the same word for
// word on both sides, so its anti-alias guard shows in no delta — it is `recycle.test.ts`
// that proves it, directly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuRowState } from './state.ts';
import { createWebgpuRowCommit } from './commit.ts';
import {
  referenceRowCommit,
  referenceRowState,
} from '../../../../../bench/oracles/browser/drawable-rows.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import {
  catalogue,
  etatComplet,
  image,
  mount,
  offsetsPar,
  PAGES,
  SLOTS,
  type Plan,
} from './commit.fixture.ts';

/**
 * Nine hostile images: empty, one page, all resident, a page that leaves from the FRONT — later
 * ranks then shift as a block, which F4 moves instead of rewriting — and its return, a reversed cut
 * order that forbids the move, and a restarted table epoch.
 */
function images(): Plan[] {
  const vide = offsetsPar(() => -1);
  const uneSeule = offsetsPar((page) => (page ? -1 : 4));
  const tout = offsetsPar((page) => page * 8);
  const sansPremiere = offsetsPar((page) => (page ? page * 8 : -1));
  const inverse = offsetsPar((page) => (PAGES - 1 - page) * 8);
  const decale = offsetsPar((page) => (page < PAGES - 1 ? (page + 1) * 8 : -1));
  return [
    { offsets: vide, coupeProcesseur: false },
    { offsets: uneSeule, coupeProcesseur: false },
    { offsets: tout, coupeProcesseur: false },
    { offsets: tout, coupeProcesseur: true },
    { offsets: sansPremiere, coupeProcesseur: true },
    { offsets: tout, coupeProcesseur: true },
    { offsets: inverse, coupeProcesseur: true, descendante: true },
    { offsets: decale, coupeProcesseur: false },
    { offsets: tout, coupeProcesseur: true },
  ];
}

test('F4: the row table stays identical image after image, including empty, reversed and replayed', (t) => {
  // No clock decides what a sync writes: a pass handed no frame budget writes every owed row
  // (`claims.ts`). The claims were once served under a wall-clock budget read in place, and a
  // loaded machine left one side a row short (`candidateCount`, #573). Here time leaps back and
  // forth a thousand seconds at every read: a pass that read it would not write what the other does.
  let reads = 0;
  t.mock.method(performance, 'now', () => (reads++ % 2) * 1e6);
  const neuf = mount(createWebgpuRowState, createWebgpuRowCommit);
  // The frozen oracle keeps one dirty interval and no per-row marks, which no commit reads.
  const ref = mount(
    referenceRowState as unknown as typeof createWebgpuRowState,
    referenceRowCommit,
  );
  const seq = images();
  for (let tour = 0; tour < seq.length; tour++) {
    if (tour === 8) {
      // A restarted table epoch with no residency change: voids every source rank.
      neuf.rows.tableEpoch += 1;
      ref.rows.tableEpoch += 1;
    }
    image(neuf, seq[tour]);
    image(ref, seq[tour]);
    assert.deepEqual(etatComplet(neuf.rows), etatComplet(ref.rows), `image ${tour}`);
  }
});

test("F5: a page's rank equals the hash table's, a page outside the catalogue has none", () => {
  const pages = catalogue();
  const neuf = createWebgpuRowState(pages, SLOTS);
  const ref = referenceRowState(pages, SLOTS);
  for (const page of pages)
    assert.equal(neuf.pageIndexOf(page), ref.pageIndexOf(page), `page ${page.url}`);
  // A page the catalogue does not hold: no rank on either side.
  const sansRang = { id: 998, url: 'x/1' } as unknown as PageRec;
  assert.equal(neuf.pageIndexOf(sansRang), undefined);
  assert.equal(ref.pageIndexOf(sansRang), undefined);
});
