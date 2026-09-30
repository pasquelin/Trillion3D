import test from 'node:test';
import assert from 'node:assert/strict';
import { validateScene, progress, checkpoint } from './validation.ts';
import { LightingTransportError } from './contracts.ts';
import { sceneWithBlocker } from '../../../fixtures/lightingTransportScene.ts';

const invalid = (scene: unknown, words: string) =>
  assert.throws(
    () => validateScene(scene as any),
    (error: any) =>
      error instanceof LightingTransportError &&
      error.code === 'INVALID_SCENE' &&
      error.message.includes(words),
  );

test('transport scene validation independently checks counts, geometry and material bounds', () => {
  assert.doesNotThrow(() => validateScene(sceneWithBlocker(false, 1)));
  for (const field of ['surfaces', 'patches']) {
    const scene = sceneWithBlocker(false, 1);
    (scene as any)[field] = [];
    invalid(scene, 'surfaces and patches');
  }
  for (const field of ['origin', 'u', 'v'])
    for (const values of [
      [1, 2],
      [1, 2, 3, 4],
      [1, NaN, 3],
    ]) {
      const scene = sceneWithBlocker(false, 1);
      (scene.surfaces[0] as any)[field] = values;
      invalid(scene, `surface.${field}`);
    }
  for (const field of ['columns', 'rows'])
    for (const value of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const scene = sceneWithBlocker(false, 1);
      (scene.surfaces[0] as any)[field] = value;
      invalid(scene, 'positive integers');
    }
  const mismatch = sceneWithBlocker(false, 1);
  mismatch.surfaces[0].rows = 3;
  invalid(mismatch, 'patch count');
  for (const patch of [{ id: 1 }, { surface: 0.5 }, { surface: -1 }, { surface: 99 }]) {
    const scene = sceneWithBlocker(false, 1);
    Object.assign(scene.patches[0], patch);
    invalid(scene, 'stable array indices');
  }
  for (const field of ['center', 'normal', 'u', 'v', 'albedo', 'emission']) {
    const scene = sceneWithBlocker(false, 1);
    (scene.patches[0] as any)[field] = [1, Infinity, 3];
    invalid(scene, `patch.${field}`);
  }
  for (const patch of [
    { area: 0 },
    { area: -1 },
    { area: Infinity },
    { area: NaN },
    { albedo: [-0.1, 0, 1] },
    { albedo: [0, 1.1, 1] },
    { emission: [0, 0, -0.1] },
    { normal: [0, 0, 2] },
  ]) {
    const scene = sceneWithBlocker(false, 1);
    Object.assign(scene.patches[0], patch);
    assert.throws(
      () => validateScene(scene),
      (error: any) => error.code === 'INVALID_SCENE',
    );
  }
  for (const radius of [0, -1, NaN, Infinity]) {
    const scene = sceneWithBlocker(false, 1);
    scene.sphere = { center: [1, 2, 3], radius } as any;
    invalid(scene, 'Sphere radius');
  }
  const sphere = sceneWithBlocker(false, 1);
  sphere.sphere = { center: [1, NaN, 3], radius: 1 } as any;
  invalid(sphere, 'sphere.center');
});

test('progress reports stable values, isolates observer failures and honors cancellation on either side', () => {
  const events: unknown[] = [];
  progress({ onProgress: (item) => events.push(item) }, 'visibility', 3, 7);
  assert.deepEqual(events, [{ eventVersion: 1, stage: 'visibility', completed: 3, total: 7 }]);
  assert.doesNotThrow(() =>
    progress(
      {
        onProgress: () => {
          throw new Error('observer');
        },
      },
      'solve',
      1,
      2,
    ),
  );
  assert.doesNotThrow(() => checkpoint({}));
  assert.throws(
    () => checkpoint({ cancelled: () => true }),
    (error: any) => error.code === 'CANCELLED' && error.message.length > 0,
  );
  let cancelled = false;
  assert.throws(
    () =>
      progress(
        {
          cancelled: () => cancelled,
          onProgress: () => {
            cancelled = true;
          },
        },
        'geometry',
        1,
        2,
      ),
    (error: any) => error.code === 'CANCELLED',
  );
  const stop = new LightingTransportError('CANCELLED', 'stop');
  assert.throws(
    () =>
      progress(
        {
          onProgress: () => {
            throw stop;
          },
        },
        'oracle',
        1,
        2,
      ),
    (error) => error === stop,
  );
  assert.doesNotThrow(() =>
    progress(
      {
        onProgress: () => {
          throw new LightingTransportError('INVALID_SCENE', 'observer');
        },
      },
      'solve',
      1,
      2,
    ),
  );
});
