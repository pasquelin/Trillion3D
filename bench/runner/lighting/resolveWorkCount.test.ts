// #1369: a moving image's resolve against develop's, counted over a small atrium: the shadow setup
// only where a list holds a shadowed light — nowhere with no shadow slot —, two weight walks for
// three, the same lights and shadows shaded.
import test from 'node:test';
import assert from 'node:assert/strict';
import { camera } from '../../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts';
import { ATRIUM_POSES, atriumDepth, atriumLamps } from './lightTileAtrium.ts';
import { countResolveWork } from './resolveWorkCount.ts';

const lights = atriumLamps(200, 4);
const { eye, yaw, pitch } = ATRIUM_POSES[1];
const view = camera(eye, yaw, pitch, 60, 432, 279);
const depths = atriumDepth(view);

test('the moving resolve walks two weights for three', () => {
  const { before, after } = countResolveWork(
    view,
    depths,
    lights,
    lights.map((_, rank) => rank < 64),
  );
  assert.ok(before.weights > 0 && before.shadows > 0);
  assert.equal(after.weights * 3, before.weights * 2);
  assert.equal(after.shaded, before.shaded);
  assert.equal(after.shadows, before.shadows);
  assert.ok(after.setup < before.setup, `${after.setup} pixels set up for ${before.setup}`);
});

test('with no shadow slot no pixel sets up a shadow read', () => {
  const { covered, before, after } = countResolveWork(
    view,
    depths,
    lights,
    lights.map(() => false),
  );
  assert.equal(before.setup, covered);
  assert.equal(after.setup, 0);
  assert.equal(after.shadows + after.weights, 0);
});
