import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { advanceMixers, Camera, Scene } from '../packages/sdk-browser/src/index.ts';
import { catchPagehide } from './docs/examples/capture.ts';
import { runControlledExample } from './docs/examples/controlled.ts';

type Values = { mode: string; openingDistance: number; openness: number };

const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} is not ${expected}`);

test('door clip follows camera proximity once and manual control takes over', async (t) => {
  const html = await readFile(
    new URL('../site/examples/doors-that-open.html', import.meta.url),
    'utf8',
  );
  const scene = new Scene(() => Promise.reject(new Error('the page loads no model')));
  const camera = new Camera('perspective');
  let frame = () => {},
    disposed = false;
  const world = {
    scene,
    camera,
    controls: { target: { copy() {} }, minDistance: 0, maxDistance: 0, maxPolarAngle: 0 },
    beforeFrame: (hook: () => void) => void (frame = hook),
    invalidate() {},
    dispose: () => void (disposed = true),
  };
  const pagehide = catchPagehide(t);
  const { values, change } = await runControlledExample<Values>(html, world);

  const left = scene.getObjectByName('leftDoor'),
    right = scene.getObjectByName('rightDoor');
  assert.ok(left && right);
  assert.equal(left.position.x, -right.position.x);
  assert.equal(left.children[0]!.position.x, -right.children[0]!.position.x);

  camera.position.set(0, 1.7, 10);
  frame();
  assert.deepEqual([left.rotation.y, right.rotation.y], [0, 0]);
  camera.position.z = 4;
  frame();
  near(left.rotation.y, -0.65);
  near(right.rotation.y, 0.65);
  camera.position.z = 2;
  frame();
  assert.ok(left.rotation.y < -1.29 && right.rotation.y > 1.29);

  const sampled = [left.rotation.y, right.rotation.y];
  advanceMixers(scene, 3);
  assert.deepEqual([left.rotation.y, right.rotation.y], sampled);
  camera.position.z = 10;
  frame();
  assert.deepEqual([left.rotation.y, right.rotation.y], [0, 0]);

  Object.assign(values, { mode: 'manual', openness: 0.25 });
  change(values);
  camera.position.z = 2;
  frame();
  near(left.rotation.y, -0.325);
  near(right.rotation.y, 0.325);
  advanceMixers(scene, 3);
  near(right.rotation.y, 0.325);

  pagehide();
  assert.ok(disposed);
});
