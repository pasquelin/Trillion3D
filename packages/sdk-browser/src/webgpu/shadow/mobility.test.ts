// A placement turns moving at its first move and stays so; its rows carry the word the page cull
// splits a page's casters by, and every row is rewritten when a placement turns moving.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createShadowMobility } from './mobility.ts';
import { createShadowResidence } from './residence.ts';

test('the first move promotes a placement and opens the static layer; its later moves do not', () => {
  const mobility = createShadowMobility();
  mobility.ensure(3, 5);
  assert.equal(mobility.layered, false);
  mobility.move(1);
  assert.equal(mobility.takePromoted(), true);
  assert.equal(mobility.layered, true);
  mobility.move(1);
  assert.equal(mobility.takePromoted(), false, 'already moving: only its moving casters stale');
  const pushed: number[][] = [];
  const placementOf = (row: number) => [0, 1, 1, 2, -1][row];
  mobility.writeRows(placementOf, 5, 2, 2, (first, count) => pushed.push([first, count]));
  assert.deepEqual(pushed, [[0, 5]], 'every row once after a promotion');
  assert.deepEqual([...mobility.rowWords], [0, 1, 1, 0, 0]);
  mobility.writeRows(placementOf, 5, 3, 4, (first, count) => pushed.push([first, count]));
  assert.deepEqual(pushed[1], [3, 2], 'then the rows the table rewrote');
});

test('a residency flag that drops and rises between two plans is no change for the shadows', () => {
  const residence = createShadowResidence();
  const flags = new Uint32Array(4),
    changed: number[] = [];
  flags[2] = 1;
  residence.note(2, 4);
  residence.flush(flags, (page) => changed.push(page));
  assert.deepEqual(changed, [2], 'a page that arrived');
  // A row rewrite: the flag drops, then rises again before the next plan reads it.
  residence.note(2, 4);
  residence.note(2, 4);
  residence.flush(flags, (page) => changed.push(page));
  assert.deepEqual(changed, [2], 'nothing new: the light cuts see the same page');
  flags[2] = 0;
  residence.note(2, 4);
  residence.flush(flags, (page) => changed.push(page));
  assert.deepEqual(changed, [2, 2], 'a page that left');
});
