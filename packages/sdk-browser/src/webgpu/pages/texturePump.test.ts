// During a pose barrier the shadow drain does not pump tiles: an arrival invalidates
// every map (`shadowsFollowTextures`) and the queue would never empty.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pumpResidentTiles } from './prepare/lightResources.ts';

test('an ordinary frame pumps tiles requested by the previous image', () => {
  const pumped: number[] = [];
  const served = pumpResidentTiles(
    { pump: (frame) => ({ served: pumped.push(frame) + 1 }) },
    7,
    false,
  );
  assert.deepEqual(pumped, [7]);
  assert.equal(served, 2, 'what it served, which restarts a still average (`restartTaaOnLanding`)');
});

test('a pose barrier pumps nothing: the drain admits no new tile', () => {
  const pumped: number[] = [];
  assert.equal(
    pumpResidentTiles({ pump: (frame) => ({ served: pumped.push(frame) }) }, 7, true),
    0,
  );
  assert.deepEqual(pumped, []);
});

test('without a streamer, pumping neither allocates nor throws', () => {
  pumpResidentTiles(undefined, 0, false);
  pumpResidentTiles(undefined, 0, true);
});
