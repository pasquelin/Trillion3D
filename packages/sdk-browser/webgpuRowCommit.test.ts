// Lot F, F4 and F5: F4 (webgpuRowCommit.ts) no longer rewrites the page, offset, epoch and inverse
// rank of a row that `sourceRowOf` made exact; F5 (webgpuRowState.ts) makes a catalogue page's rank
// travel on the page itself (`packedIndex`) instead of a hash table. The oracles are the
// implementations from before lot F, copied as-is into `oracles/lignes-dessinables.ts`. The comparison
// is on the full array state after a sequence of images, not on a single image: that is where reused
// rows show.
//
// What this comparison CANNOT prove: what lot F did not change. `sourceRowOf` is the same word for
// word on both sides, so its anti-alias guard shows in no delta — it is `webgpuRowRecycle.test.ts`
// that proves it, directly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuRowState } from './webgpuRowState.ts';
import { createWebgpuRowCommit } from './webgpuRowCommit.ts';
import { referenceRowCommit, referenceRowState } from './bench/oracles/lignes-dessinables.ts';
import type { PageRec } from './pageSelection.ts';
import {
  catalogue,
  etatComplet,
  image,
  mount,
  offsetsPar,
  PAGES,
  SLOTS,
  type Plan,
} from './webgpuRowCommitFixture.ts';

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

test('F4: the row table stays identical image after image, including empty, reversed and replayed', () => {
  const neuf = mount(createWebgpuRowState, createWebgpuRowCommit);
  const ref = mount(referenceRowState, referenceRowCommit);
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

test("F5: a page's rank equals the hash table's, a foreign page at a usurped rank fools nobody", () => {
  const pages = catalogue();
  const neuf = createWebgpuRowState(pages, SLOTS);
  const ref = referenceRowState(pages, SLOTS);
  for (const page of pages)
    assert.equal(neuf.pageIndexOf(page), ref.pageIndexOf(page), `page ${page.url}`);
  // A foreign page that would carry the same `packedIndex` as a real page (aliasing) must not be
  // confused with it on either side.
  const etrangere = { id: 999, url: 'x/0', packedIndex: 0 } as unknown as PageRec;
  assert.equal(neuf.pageIndexOf(etrangere), undefined);
  assert.equal(ref.pageIndexOf(etrangere), undefined);
  // A page with no rank at all.
  const sansRang = { id: 998, url: 'x/1' } as unknown as PageRec;
  assert.equal(neuf.pageIndexOf(sansRang), undefined);
  assert.equal(ref.pageIndexOf(sansRang), undefined);
});
