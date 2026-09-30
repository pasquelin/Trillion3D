import test from 'node:test';
import assert from 'node:assert/strict';
import { validateScene, progress } from './validation.ts';
import { sceneWithBlocker } from '../../../../../tests/fixtures/lightingTransportScene.ts';

test('scene validation accepts full reflectance and diagnoses invalid area, color and normals', () => {
  const valid = sceneWithBlocker(true, 1);
  valid.patches[0].albedo = [0, 1, 0.5];
  assert.doesNotThrow(() => validateScene(valid));
  for (const [update, message] of [
    [{ area: -1 }, 'Patch area'],
    [{ albedo: [-0.1, 0, 0] }, 'Albedo'],
    [{ emission: [-1, 0, 0] }, 'emission'],
    [{ normal: [0, 0, 2] }, 'normalized'],
  ] as const) {
    const scene = sceneWithBlocker(true, 1);
    Object.assign(scene.patches[0], update);
    assert.throws(
      () => validateScene(scene),
      (error: any) =>
        error.name === 'LightingTransportError' &&
        error.code === 'INVALID_SCENE' &&
        error.message.includes(message),
    );
  }
});

test('already cancelled progress does not publish a completion event', () => {
  let published = false;
  assert.throws(
    () =>
      progress(
        {
          cancelled: () => true,
          onProgress: () => {
            published = true;
          },
        },
        'geometry',
        0,
        1,
      ),
    (error: any) => error.code === 'CANCELLED',
  );
  assert.equal(published, false);
});
