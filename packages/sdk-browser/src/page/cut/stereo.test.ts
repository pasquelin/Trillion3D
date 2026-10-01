import test from 'node:test';
import assert from 'node:assert/strict';
import { createStereoCut } from './stereo.ts';
import { ruleDag } from './cutRule.fixture.ts';
import { createEngineCamera, readCameraWorld } from '../../camera/world.ts';
import { wideCamera } from '../selection/dag.fixture.ts';
import { createHeldResidency } from './held.ts';
import { createSelectionResult } from './state.ts';

test('two images share exactly one residency cut, keeping separate lists and renewed frames', () => {
  const root = ruleDag(8),
    camera = readCameraWorld(createEngineCamera(), wideCamera());
  const cut = createStereoCut(),
    held = createHeldResidency();
  let images = 0;
  const end = held.endImage;
  held.endImage = () => {
    images++;
    end();
  };
  cut.begin([
    { camera, viewport: [1024, 1024] },
    { camera, viewport: [1024, 1024] },
  ]);
  const left = cut.select([root], camera, { held, pixelError: 0, result: createSelectionResult() });
  const right = cut.select([root], camera, {
    held,
    pixelError: 0,
    result: createSelectionResult(),
  });
  assert.equal(images, 1);
  assert.notEqual(left, right);
  assert.notEqual(left.shown, right.shown);
  assert.deepEqual(left.shown, right.shown);
  left.shown.length = 0;
  assert.ok(right.wanted.length > 0);
  cut.begin(cut.views);
  cut.select([root], camera, { held, pixelError: 0 });
  assert.equal(images, 2);
});
