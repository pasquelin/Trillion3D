// The page table's host side: ranges claimed first-fit and refused when the fixed table is full,
// and an upload of the words a frame changed, in contiguous runs, nothing when nothing changed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createShadowTable } from './table.ts';

test('ranges are claimed first-fit, a freed hole is reused, and a range too large is refused', () => {
  const table = createShadowTable();
  assert.equal(table.claim(0, 100), true);
  assert.equal(table.claim(1, 50), true);
  assert.deepEqual([table.baseOf(0), table.baseOf(1)], [0, 100]);
  table.release(0);
  assert.equal(table.claim(2, 60), true);
  assert.equal(table.baseOf(2), 0, 'the hole the first range left');
  assert.equal(table.sliceAt(120), 1);
  assert.equal(table.claim(3, table.entries), false, 'no room for a whole table more');
});

test('an upload carries the changed words in contiguous runs, and nothing on a still frame', () => {
  const table = createShadowTable();
  table.flush(() => {});
  for (const entry of [9, 7, 8, 40]) table.write(entry, entry + 1);
  table.write(40, 41);
  const runs: number[][] = [];
  table.flush((first, count) => runs.push([first, count]));
  assert.deepEqual(runs, [
    [7, 3],
    [40, 1],
  ]);
  const version = table.version;
  table.flush((first, count) => runs.push([first, count]));
  table.write(7, 8);
  assert.equal(runs.length, 2);
  assert.equal(table.version, version, 'writing the same word is no change');
});
