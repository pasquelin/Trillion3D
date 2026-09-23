// Recycling of a page-table row, proved DIRECTLY.
//
// `sourceRowOf` (commit.ts) returns the row where the previous image wrote a page, or -1
// when it can no longer be reused as it stands. Its `rowPageIndex[source] !== pageIndex` guard covers
// the alias: page P left the cut, its row was taken by another page, and `rowOfPage[P]` still names
// it. If P comes back at THE OFFSET THAT ROW NOW CARRIES — which happens as soon as a cache slot is
// returned then taken again — offset and epoch both match, and without the guard the row is "reused
// as it stands": it keeps describing the other cluster while the table gives it as P.
//
// No differential comparison can say it: the oracle from before lot F carries the same function
// word for word (`../../../../../bench/oracles/browser/lignes-dessinables.ts`), so both sides would be wrong together.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_INFO_STRIDE } from '../../visibility/types.ts';
import { image, mount, offsetsPar } from './commit.fixture.ts';

const MOTS = PAGE_INFO_STRIDE / 4;

test('a row taken by another page cannot be inherited at its new offset', () => {
  const mounted = mount();
  const { rows } = mounted;
  const plan = (offsets: (page: number) => number) => ({
    offsets: offsetsPar(offsets),
    coupeProcesseur: true,
  });
  // Page 0 holds offset 0, page 1 offset 8.
  image(
    mounted,
    plan((p) => (p === 0 ? 0 : p === 1 ? 8 : -1)),
  );
  const ligne = rows.rowOfPage[0];
  assert.ok(ligne >= 0, 'page 0 holds a row');
  // Page 0 leaves, page 3 takes offset 0: ranks tighten and page 0's row comes back to page 1, which
  // carries offset 8.
  image(
    mounted,
    plan((p) => (p === 1 ? 8 : p === 3 ? 0 : -1)),
  );
  assert.equal(rows.rowOfPage[0], ligne, 'the inverse rank of the left page stays as-is');
  assert.equal(rows.rowPageIndex[ligne], 1, 'the row now describes another page');
  const offsetUsurpe = rows.rowOffsetWords[ligne];
  // Page 1 leaves in turn, and page 0 comes back EXACTLY to the offset its old row carries.
  image(
    mounted,
    plan((p) => (p === 0 ? offsetUsurpe : p === 3 ? 0 : -1)),
  );
  // Each row describes its own page, in the state as in the words the GPU reads.
  for (let row = 0; row < rows.rowCount; row++) {
    const page = rows.rowPageIndex[row];
    assert.equal(rows.rowOfPage[page], row, `row ${row}: inverse rank of page ${page}`);
    assert.equal(
      (rows.pageTableInts as Uint32Array)[row * MOTS + 4],
      mounted.pages[page].id,
      `row ${row}: the table names page ${page}`,
    );
    assert.equal(rows.rowOffsetWords[row], rows.residentOffsetWords[page], `row ${row}: offset`);
  }
});
