import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runExampleModule } from './docs/examples/capture.ts';
import {
  animation,
  geometry,
  light,
  material,
  math,
  object,
} from '../packages/sdk-browser/src/index.ts';
import { advanceMixers } from '../packages/sdk-core/src/world/animation/index.ts';
import { Camera } from '../packages/sdk-core/src/world/camera/camera.ts';
import { Scene } from '../packages/sdk-browser/src/world/core/scene.ts';
import { describe, type ControlSpec } from '../site/examples/kit/controls.ts';

type Values = Record<string, boolean | number | string>;

test('the canal dolly is scene-driven and its controls pause, replay and change speed', async () => {
  const html = await readFile(
    new URL('../site/examples/a-dolly-along-the-canal.html', import.meta.url),
    'utf8',
  );
  const scene = new Scene(() => Promise.reject(new Error('the page loads no model')));
  const camera = new Camera('perspective');
  let values: Values = {};
  let change: (next: Values, key?: string) => void = () => {};
  let specs: Record<string, ControlSpec> = {};
  await runExampleModule(html, {
    engine: {
      createWorld: () => ({
        scene,
        camera,
        invalidate() {},
        onFrame() {},
        onPageHide() {},
        dispose() {},
      }),
      animation,
      geometry,
      material,
      object,
      light,
      math,
    },
    kit: {
      controls: (nextSpecs: Record<string, ControlSpec>, callback: typeof change) => {
        specs = nextSpecs;
        values = describe(specs).values as Values;
        change = callback;
        callback(values);
        return values;
      },
      readout: () => () => {},
    },
  });

  assert.equal(camera.parent, scene, 'the world loop can reach the camera mixer');
  assert.deepEqual(values, { paused: false, speed: 1 });
  const start = camera.position.clone();
  assert.equal(advanceMixers(scene, 3), true);
  assert.ok(camera.position.z < start.z);

  values.paused = true;
  change(values, 'paused');
  const paused = camera.position.clone();
  assert.equal(advanceMixers(scene, 2), false);
  assert.ok(camera.position.equals(paused));

  values.speed = 2;
  change(values, 'speed');
  values.paused = false;
  change(values, 'paused');
  assert.equal(advanceMixers(scene, 1), true);
  assert.ok(camera.position.z < paused.z - 10);

  assert.equal(advanceMixers(scene, 20), false);
  assert.ok(camera.position.z < -38, 'the one-way journey stays at the far quay');

  values.paused = true;
  change(values, 'paused');
  (specs.replay as () => void)();
  assert.ok(camera.position.distanceTo(start) < 1e-5);
  assert.equal(advanceMixers(scene, 1), false, 'replay respects pause');
});
