import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Camera } from '../packages/sdk-core/src/world/camera/camera.ts';
import { math, pose } from '../packages/sdk-browser/src/index.ts';
import { runExampleModule } from './docs/examples/capture.ts';

const page = (name: string) =>
  readFile(new URL(`../site/examples/${name}.html`, import.meta.url), 'utf8');
const family = new Proxy({}, { get: () => () => ({}) });
const node = () => ({ position: math.vector3(), rotation: math.euler(), add() {} });
const previous = globalThis.addEventListener;

test('the near-plane lesson writes every slider value and keeps valid optics', async () => {
  const camera = new Camera('perspective');
  let change = (_values: { nearPlane: number }) => {};
  globalThis.addEventListener = () => undefined;
  try {
    await runExampleModule(await page('the-near-plane-cuts-a-wall'), {
      engine: {
        createWorld: () => ({
          scene: { background: null, add() {} },
          camera,
          invalidate() {},
          dispose() {},
        }),
        geometry: family,
        material: family,
        object: { mesh: node },
        light: family,
        math,
      },
      kit: {
        controls(_specs: object, callback: typeof change) {
          change = callback;
          callback({ nearPlane: 0.1 });
        },
      },
    });
    for (const nearPlane of [0.1, 7.3, 14]) {
      change({ nearPlane });
      assert.equal(camera.near, nearPlane);
      assert.ok(Number.isFinite(camera.near) && camera.near > 0 && camera.near < camera.far);
    }
  } finally {
    globalThis.addEventListener = previous;
  }
});

test('Home restores its exact pose after every point of interest and a manual move', async () => {
  const camera = new Camera('perspective');
  const target = math.vector3();
  let buttons = {} as Record<'home' | 'tower' | 'square' | 'hillside', () => void>;
  globalThis.addEventListener = () => undefined;
  try {
    await runExampleModule(await page('the-home-pose'), {
      engine: {
        createWorld: () => ({
          scene: { background: null, add() {} },
          camera,
          controls: { target, update() {} },
          invalidate() {},
          dispose() {},
        }),
        geometry: family,
        material: family,
        object: { mesh: node, group: node },
        light: family,
        math,
        pose,
      },
      kit: { controls: (specs: typeof buttons) => void (buttons = specs) },
    });
    const snapshot = () => ({
      position: camera.position.toArray(),
      quaternion: camera.quaternion.toArray(),
      target: target.toArray(),
      fov: camera.fov,
    });
    const forward = math.vector3(),
      toward = math.vector3();
    const assertTargeted = () => {
      camera.getWorldDirection(forward);
      toward.copy(target).sub(camera.position).normalize();
      assert.ok(forward.distanceTo(toward) < 1e-12);
    };
    const home = snapshot();
    for (const name of ['tower', 'square', 'hillside'] as const) {
      buttons[name]();
      assertTargeted();
      assert.notDeepEqual(snapshot(), home);
      buttons.home();
      assert.deepEqual(snapshot(), home);
    }
    camera.position.set(30, 2, -8);
    camera.quaternion.set(0, 1, 0, 0);
    camera.fov = 35;
    target.set(4, 1, 9);
    buttons.home();
    assert.deepEqual(snapshot(), home);
  } finally {
    globalThis.addEventListener = previous;
  }
});
