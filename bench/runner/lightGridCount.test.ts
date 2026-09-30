// #1369: each pixel walks its cell's list, a few lights above those that reach it — never one that
// reaches it missed —, and the grid pass reads no depth: its tests follow its columns and lights.
import test from 'node:test';
import assert from 'node:assert/strict';
import { camera } from '../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts';
import { ATRIUM_POSES, atriumDepth, atriumLamps } from './lightTileAtrium.ts';
import { LIGHTING_RATES, countGrid, lightingModel } from './lightGridCount.ts';

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

test('the model prices the pass by its tests and entries, the resolve by its lights in and out of range', () => {
  const work = { columns: 1, cells: 256, columnTests: 1e6, solves: 1e5, entries: 1e6 };
  const r = LIGHTING_RATES;
  const m = lightingModel({ covered: 1e6, listed: 9e6, reach: 7e6, missed: 0, work });
  const pass = (1.2e6 * r.pairNs * 1e3 + 2 * (1e6 + 256) * r.texelPs) / 1e9;
  assert.ok(Math.abs(m.tilePass - pass) < 1e-12);
  assert.ok(Math.abs(m.lightWork - (7e6 * r.inRangePs + 2e6 * r.outOfRangePs) / 1e9) < 1e-12);
  assert.ok(Math.abs(r.pairNs - 0.2) < 1e-3, "develop's 1.21 ms over its 6.048 million pairs");
});
