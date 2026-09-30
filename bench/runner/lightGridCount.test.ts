// #1369: each pixel walks its cell's list, a few lights above those that reach it — never one that
// reaches it missed —, and the grid pass reads no depth: its tests follow its columns and lights.
import test from 'node:test';
import assert from 'node:assert/strict';
import { camera } from '../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts';
import { ATRIUM_POSES, atriumDepth, atriumLamps } from './lightTileAtrium.ts';
import { countGrid } from './lightGridCount.ts';

test('the cell lists hold every light that reaches a pixel, and few more', () => {
  const { eye, yaw, pitch } = ATRIUM_POSES[1];
  const view = camera(eye, yaw, pitch, 60, 864, 558);
  const lights = atriumLamps(200, 4);
  const { listed, reach, missed, work } = countGrid(view, atriumDepth(view), lights);
  assert.equal(missed, 0);
  assert.ok(reach > 0 && listed >= reach, `${listed} listed, ${reach} reaching`);
  assert.ok(listed < 1.6 * reach, `${listed / reach} listed per reaching`);
  assert.equal(work.columnTests, work.columns * lights.length, 'each light once a column');
  assert.ok(work.solves < work.columnTests / 4, `${work.solves} runs solved`);
});
