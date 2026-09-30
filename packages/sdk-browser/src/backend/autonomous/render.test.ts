// #1016: a capture after a moving camera held the first WebGL2 frame whose cut had not moved, with
// pages of it still awaited; the two sides of the A/A drew what each had loaded (44 186 px on
// sponza's `overview`). As on WebGPU, a frame is still only once nothing it asks is awaited.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stillFrame } from './stillFrame.ts';

const loaded = { array: new Uint32Array(3) },
  awaited = { array: undefined };

test('a held frame is the still frame only once every page the view asks for is loaded', () => {
  assert.equal(stillFrame([loaded, loaded]), true);
  assert.equal(stillFrame([loaded, awaited]), false, 'a page still on its way');
  assert.equal(stillFrame([]), true);
});
