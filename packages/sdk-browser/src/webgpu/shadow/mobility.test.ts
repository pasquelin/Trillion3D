// A placement turns moving at its first move and stays so; its rows carry the word the page cull
// splits a page's casters by, and every row is rewritten when a placement turns moving.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createShadowMobility } from './mobility.ts';
import { MOVE_MOVING, MOVE_PROMOTED } from '../../placement/update.ts';
import { createShadowResidence } from './residence.ts';

test('the first move promotes a placement and opens the static layer; its later moves do not', () => {
  const mobility = createShadowMobility();
  mobility.ensure(3, 5, () => new Float64Array(16));
  assert.equal(mobility.layered, false);
  assert.equal(mobility.move(1), MOVE_PROMOTED);
  assert.equal(mobility.layered, true);
  assert.equal(mobility.move(1), MOVE_MOVING, 'already moving: only its moving casters stale');
  const pushed: number[][] = [];
  const placementOf = (row: number) => [0, 1, 1, 2, -1][row];
  mobility.writeRows(placementOf, 5, 2, 2, (first, count) => pushed.push([first, count]));
  assert.deepEqual(pushed, [[0, 5]], 'every row once after a promotion');
  assert.deepEqual([...mobility.rowWords], [0, 1, 1, 0, 0]);
  mobility.writeRows(placementOf, 5, 3, 4, (first, count) => pushed.push([first, count]));
  assert.deepEqual(pushed[1], [3, 2], 'then the rows the table rewrote');
});

// A write that leaves a placement where it stands — a pose copied again, a row inside a written
// range — opens no static layer; a row taken or parked, or a new pose, does.
test('a placement posed where it already stands does not move', () => {
  const mobility = createShadowMobility();
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  mobility.ensure(2, 2, () => identity);
  mobility.move(0, identity);
  assert.equal(mobility.layered, false, 'same pose: still');
  mobility.move(0);
  assert.equal(mobility.layered, true, 'taken or parked: moved');
  const shifted = identity.slice();
  shifted[12] = 1;
  mobility.move(1, shifted);
  assert.deepEqual([...mobility.rowWords], [0, 0]);
  const pushed: number[] = [];
  mobility.writeRows(
    (row) => row,
    2,
    0,
    1,
    () => pushed.push(0),
  );
  assert.deepEqual([...mobility.rowWords], [1, 1], 'a new pose: moved');
});

test('a residency flag that drops and rises between two plans is no change for the shadows', () => {
  const residence = createShadowResidence();
  const flags = new Uint32Array(4),
    words = new Int32Array(4).fill(-1),
    changed: number[] = [];
  const flush = () => residence.flush(flags, words, true, (page) => changed.push(page));
  flags[2] = 1;
  residence.noteRow(2, 4);
  flush();
  assert.deepEqual(changed, [2], 'a page that arrived');
  // A row rewrite: the flag drops, then rises again before the next plan reads it.
  residence.noteRow(2, 4);
  residence.noteRow(2, 4);
  flush();
  assert.deepEqual(changed, [2], 'nothing new: the light cuts see the same page');
  flags[2] = 0;
  residence.noteRow(2, 4);
  flush();
  assert.deepEqual(changed, [2, 2], 'a page that left');
});

test('under the CPU cut, a page the pool takes in or gives back is a change for the shadows', () => {
  const residence = createShadowResidence();
  const flags = new Uint32Array(4),
    words = new Int32Array(4).fill(-1),
    changed: number[] = [];
  const flush = (gpuCut: boolean) =>
    residence.flush(flags, words, gpuCut, (page) => changed.push(page));
  words[1] = 640;
  residence.notePool(1, 4);
  flush(false);
  assert.deepEqual(changed, [1], 'the CPU cut sees the page arrive, though no row flag rose');
  words[1] = 1280;
  residence.notePool(1, 4);
  flush(false);
  assert.deepEqual(changed, [1], 'a slot that moves is the same page');
  // A GPU frame keeps the pool current without declaring it: its own cut reads the row flags.
  words[3] = 64;
  residence.notePool(3, 4);
  flush(true);
  words[1] = -1;
  residence.notePool(1, 4);
  flush(false);
  assert.deepEqual(changed, [1, 1], 'only the page that left since');
});

// #35: a blended caster's shadow lives in the transmittance layer, which the static layer does
// not keep: its row is drawn over every restored page, as a moving caster's.
test("a blended caster's row always counts as moving", () => {
  const mobility = createShadowMobility();
  mobility.ensure(2, 4, () => new Float64Array(16));
  mobility.writeRows(
    (row) => [0, 1, 0, 1][row],
    4,
    0,
    3,
    () => {},
    2,
  );
  assert.deepEqual([...mobility.rowWords], [0, 0, 1, 1]);
});
