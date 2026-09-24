// The CPU cut's rows: its own pages first, in its order, then the shadow casters its light cuts
// selected and the camera does not draw — rows only the shadow pass reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mount, PAGES } from './commit.fixture.ts';

test('the CPU cut writes its own rows first, then the light casters it does not draw', () => {
  const { rows, sync, pages, coupe } = mount();
  for (let page = 0; page < PAGES; page++) {
    rows.residentOffsetWords[page] = page * 16;
    rows.touchPage(page);
  }
  coupe.push(pages[0], pages[1]);
  // Page 2 awaits its bytes and page 4 is blended: neither takes a row, whoever names it.
  const cameraRows = sync.syncRowsFromCut([pages[3], pages[2], pages[4], pages[5]]);
  assert.equal(cameraRows, 2, 'the camera draws the first two rows');
  assert.equal(rows.packedCount, 4, 'two casters follow');
  assert.deepEqual(Array.from(rows.packedPageIndex.slice(0, 4)), [0, 1, 3, 5]);
});
