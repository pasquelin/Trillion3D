import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  advanceMixers,
  animation,
  Camera,
  geometry,
  light,
  material,
  math,
  object,
  Scene,
} from '../packages/sdk-browser/src/index.ts';
import { describe, type ControlSpec } from '../site/examples/kit/controls.ts';
import { runExampleModule } from './docs/examples/capture.ts';

type Values = { mode: string; openingDistance: number; openness: number };

test('door clip follows camera proximity once and manual control takes over', async (t) => {
  const html = await readFile(
    new URL('../site/examples/doors-that-open.html', import.meta.url),
    'utf8',
  );
  const scene = new Scene(() => Promise.reject(new Error('the page loads no model')));
  const camera = new Camera('perspective');
  let frame = () => {},
    disposed = false,
    pagehide = () => {};
  const world = {
    scene,
    camera,
    controls: { target: { set() {} }, minDistance: 0, maxDistance: 0, maxPolarAngle: 0 },
    onFrame: (hook: () => void) => void (frame = hook),
    invalidate() {},
    dispose: () => void (disposed = true),
  };
  const previousListener = globalThis.addEventListener;
  globalThis.addEventListener = ((type: string, listener: () => void) => {
    if (type === 'pagehide') pagehide = listener;
  }) as typeof addEventListener;
  t.after(() => void (globalThis.addEventListener = previousListener));
  let change: (values: Values) => void = () => {};
  let values = {} as Values;
  await runExampleModule(html, {
    engine: {
      advanceMixers,
      animation,
      createWorld: () => world,
      geometry,
      light,
      material,
      math,
      object,
    },
    kit: {
      announceWhatToDo() {},
      controls: (specs: Record<string, ControlSpec>, callback: (next: Values) => void) => {
        values = describe(specs).values as Values;
        change = callback;
        callback(values);
        return values;
      },
    },
  });

  const left = scene.getObjectByName('leftDoor'),
    right = scene.getObjectByName('rightDoor');
  assert.ok(left && right && left.position.x === -right.position.x);
  assert.deepEqual(left.children[0]?.position.x, -right.children[0]!.position.x);

  camera.position.set(0, 1.7, 10);
  frame();
  assert.deepEqual([left.rotation.y, right.rotation.y], [0, 0]);
  camera.position.z = 4;
  frame();
  assert.ok(Math.abs(left.rotation.y + 0.65) < 1e-6);
  assert.ok(Math.abs(right.rotation.y - 0.65) < 1e-6);
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
  assert.ok(Math.abs(left.rotation.y + 0.325) < 1e-6);
  assert.ok(Math.abs(right.rotation.y - 0.325) < 1e-6);
  advanceMixers(scene, 3);
  assert.ok(Math.abs(right.rotation.y - 0.325) < 1e-6);

  pagehide();
  assert.ok(disposed);
});
