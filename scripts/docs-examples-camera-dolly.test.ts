import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fakeWorld } from './docs/examples/world.ts';
import { runControlledExample } from './docs/examples/controlled.ts';
import { catchPagehide } from './docs/examples/capture.ts';
import { advanceMixers } from '../packages/sdk/browser.ts';

type Values = Record<string, boolean | number | string>;

test('the canal dolly is scene-driven and its controls pause, replay and change speed', async (t) => {
  const html = await readFile(
    new URL('../site/examples/a-dolly-along-the-canal.html', import.meta.url),
    'utf8',
  );
  const { world, state } = fakeWorld();
  const { scene, camera } = world;
  const pagehide = catchPagehide(t);
  const { values, change, specs } = await runControlledExample<Values>(html, world, {
    kit: { readout: () => () => {} },
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
  const replay = specs.replay;
  assert.ok(typeof replay === 'function');
  replay();
  assert.ok(camera.position.distanceTo(start) < 1e-5);
  assert.equal(advanceMixers(scene, 1), false, 'replay respects pause');
  pagehide();
  assert.equal(state.disposals, 1);
});
