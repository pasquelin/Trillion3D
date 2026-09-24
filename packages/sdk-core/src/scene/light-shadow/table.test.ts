// The page table's host side: a fixed window per slice, sized so every shadow light of the
// contract holds its range, and an upload of the words a frame changed, in contiguous runs,
// nothing when nothing changed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SHADOW_SLICES } from '../light/contracts.ts';
import { createShadowTable } from './table.ts';
import { SHADOW_TABLE_STRIDE } from './virtual.ts';

test('a range starts at its slice window, and an entry names the slice whose range holds it', () => {
  const table = createShadowTable(1024);
  table.claim(0, 100);
  table.claim(1, 50);
  assert.deepEqual([table.baseOf(0), table.baseOf(1)], [0, SHADOW_TABLE_STRIDE]);
  assert.equal(table.sliceAt(SHADOW_TABLE_STRIDE + 49), 1);
  assert.equal(table.sliceAt(SHADOW_TABLE_STRIDE + 50), -1, 'past the range, inside the window');
  table.release(1);
  assert.equal(table.sliceAt(SHADOW_TABLE_STRIDE), -1);
  assert.equal(table.entries, MAX_SHADOW_SLICES * SHADOW_TABLE_STRIDE);
});

test('an upload carries the changed words in contiguous runs, and nothing on a still frame', () => {
  const table = createShadowTable(1024);
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
