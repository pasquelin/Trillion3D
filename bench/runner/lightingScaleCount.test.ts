// #1369: in the boss's case — 3456 × 2234, a 120 Hz display, the 24.5 ms frame the recette measured
// with 200 lamps — `renderScale: 'auto'` draws the lighting at the scale its controller picks, and
// the tile pass and the resolve counted there hold 2 ms. A frame within its budget stays native.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderExtent } from '../../packages/sdk-browser/src/frame/renderScaleOption.ts';
import { camera } from '../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts';
import { ATRIUM_POSES, atriumDepth, atriumLamps } from './lightTileAtrium.ts';
import { countGrid } from './lightGridCount.ts';
import { DISPLAY, lightingModel, pickedScale } from './lightingScaleCount.ts';

test('the frame budget picks the scale: lower for a slower frame, the display within budget', () => {
  const boss = pickedScale(24.5, 1000 / 120);
  assert.ok(boss >= 0.5 && boss < 0.56, `${boss}`);
  assert.ok(pickedScale(30, 1000 / 120) <= boss);
  assert.ok(pickedScale(24.5, 1000 / 60) > boss);
  assert.equal(pickedScale(6, 1000 / 120), 1);
});

/** The lighting model of a `width` × `height` image of the atrium's second pose, 200 lamps of 4 m. */
function atriumLighting(width: number, height: number) {
  const { eye, yaw, pitch } = ATRIUM_POSES[1];
  const view = camera(eye, yaw, pitch, 60, width, height);
  return lightingModel(width, height, countGrid(view, atriumDepth(view), atriumLamps(200, 4)));
}

test("200 lamps are lit within 2 ms at the scale 'auto' picks in the boss's case", () => {
  const scale = pickedScale(24.5, 1000 / 120);
  const picked = atriumLighting(
    ...(DISPLAY.map((axis) => renderExtent(axis, scale)) as [number, number]),
  );
  assert.ok(picked.tilePass > 0 && picked.lightWork > 0 && picked.nonLight > 0);
  assert.ok(picked.sum <= 2, `${picked.sum.toFixed(3)} ms`);
  const native = atriumLighting(...DISPLAY);
  assert.ok(native.sum > 2, `native ${native.sum.toFixed(3)} ms: the scale brings it under`);
});
