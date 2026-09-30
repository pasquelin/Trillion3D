// #1369: each pixel walks its tile's list, a few lights above those that reach it — the floor a
// finer grid of depth slices or froxels could reach. Counted over a quarter-size atrium, whose
// tiles are coarse against it: 1.45 listed per reaching light here, 1.08–1.13 at 3456 × 2234.
import test from 'node:test';
import assert from 'node:assert/strict';
import { camera } from '../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts';
import { ATRIUM_POSES, atriumDepth, atriumLamps } from './lightTileAtrium.ts';
import { countGrid } from './lightGridCount.ts';

test('the tile lists hold every light that reaches a pixel, and few more', () => {
  const { eye, yaw, pitch } = ATRIUM_POSES[1];
  const view = camera(eye, yaw, pitch, 60, 864, 558);
  const { listed, reach } = countGrid(view, atriumDepth(view), atriumLamps(200, 4));
  assert.ok(reach > 0 && listed >= reach, `${listed} listed, ${reach} reaching`);
  assert.ok(listed < 1.6 * reach, `${listed / reach} listed per reaching`);
});
