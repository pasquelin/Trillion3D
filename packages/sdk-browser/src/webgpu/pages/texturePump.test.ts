// During a pose barrier the shadow drain does not pump tiles: an arrival invalidates
// every map (`shadowsFollowTextures`) and the queue would never empty.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pumpResidentTiles } from './prepare/lightResources.ts';

test('an ordinary frame pumps tiles requested by the previous image', () => {
  const pumped: number[] = [];
  pumpResidentTiles({ pump: (frame) => pumped.push(frame) }, 7, false);
  assert.deepEqual(pumped, [7]);
});

test('a pose barrier pumps nothing: the drain admits no new tile', () => {
  const pumped: number[] = [];
  pumpResidentTiles({ pump: (frame) => pumped.push(frame) }, 7, true);
  assert.deepEqual(pumped, []);
});

test('without a streamer, pumping neither allocates nor throws', () => {
  pumpResidentTiles(undefined, 0, false);
  pumpResidentTiles(undefined, 0, true);
});
