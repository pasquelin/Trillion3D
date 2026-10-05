// What a frame copies to bring the cut back stays at the readout cap's size whatever the
// catalogue: the engine's real cut on scenes from 24 thousand to 2 million pages, its readback
// against the size the engine's own layout gives the cap (`residentReadbackBytes`,
// `SELECTION_LIST_CAP`), and the catalogue-sized readout it replaced well past it. The cost of
// each copy and the cut each threshold keeps are published, never asserted: a timing is the
// machine's, not the engine's (`cutSnapshotPage.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import {
  SELECTION_LIST_CAP,
  residentReadbackBytes,
  selectionListCap,
} from '../../../packages/sdk-browser/src/gpu/dag/layout.ts';
import { loadPage, runOnDawn } from '../kit/onDawn.ts';

const SWEEP = {
  sizes: [12000, 120000, 500000, 1000000],
  levels: 8,
  frames: 120,
  rounds: 7,
  thresholds: [1, 4, 16, 64],
};

test('the readback a frame copies stays at the cap’s size, whatever the catalogue', async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'cutSnapshotPage.ts'),
    'cutSnapshot',
  )) as typeof import('./cutSnapshotPage.ts');
  const pageErrors: string[] = [];
  const { adapter, errors, rows, refused } = await runOnDawn(
    page.measureReadback,
    SWEEP,
    pageErrors,
  );
  console.log(JSON.stringify({ adapter, refused, rows }, null, 2));
  assert.deepEqual([...errors, ...pageErrors], []);
  assert.ok(rows.length >= 2, 'at least two sizes must fit on the device');
  const ceiling = residentReadbackBytes(SELECTION_LIST_CAP);
  for (const { pages, listCap, deliveredBytes } of rows) {
    assert.equal(listCap, selectionListCap(pages), `${pages} pages: the cut starts at the cap`);
    assert.equal(deliveredBytes, residentReadbackBytes(listCap), `${pages} pages: the copy`);
    assert.ok(deliveredBytes <= ceiling, `${pages} pages: ${deliveredBytes} B past ${ceiling} B`);
  }
  const largest = rows[rows.length - 1];
  assert.ok(largest.pages > SELECTION_LIST_CAP, 'the sweep must reach past the cap');
  assert.ok(largest.worstBytes > largest.deliveredBytes, 'the cap must spare a copy');
});
