import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runExampleModule } from './docs/examples/capture.ts';

test('the camera lessons write valid optics and restore complete named poses', async () => {
  const callbacks: Array<(values: Record<string, number | string>) => void> = [];
  const vector = () => ({
    value: [] as number[],
    set(...value: number[]) {
      this.value = value;
    },
  });
  const node = () => ({ position: vector(), rotation: vector(), add() {} });
  const poses: Array<{ position: number[]; target: number[]; fov: number }> = [];
  const camera = {
    near: 0.1,
    far: 2000,
    fov: 50,
    position: vector(),
    lookAt() {},
    set(pose: { position: number[]; target: number[]; fov: number }) {
      poses.push(structuredClone(pose));
      this.position.set(...pose.position);
      this.fov = pose.fov;
    },
  };
  const target = vector();
  const world = {
    scene: { background: null, add() {} },
    camera,
    controls: { target, update() {} },
    invalidate() {},
    dispose() {},
  };
  const family = new Proxy({}, { get: () => () => ({}) });
  const modules = {
    engine: {
      createWorld: () => world,
      geometry: family,
      material: family,
      object: { mesh: node, group: node },
      light: family,
      math: family,
    },
    kit: {
      controls(specs: Record<string, number[] | string[]>, change: (typeof callbacks)[number]) {
        callbacks.push(change);
        const values = Object.fromEntries(
          Object.entries(specs).map(([key, values]) => [
            key,
            typeof values[0] === 'number' ? values[2] : values[0],
          ]),
        );
        change(values);
        return values;
      },
    },
  };
  const previous = globalThis.addEventListener;
  globalThis.addEventListener = () => undefined;
  try {
    await runExampleModule(
      await readFile(
        new URL('../site/examples/the-near-plane-cuts-a-wall.html', import.meta.url),
        'utf8',
      ),
      modules,
    );
    callbacks[0]({ nearPlane: 14 });
    assert.ok(Number.isFinite(camera.near) && camera.near > 0 && camera.near < camera.far);

    await runExampleModule(
      await readFile(new URL('../site/examples/the-home-pose.html', import.meta.url), 'utf8'),
      modules,
    );
    const choose = callbacks[1];
    const expected = {
      home: { position: [18, 11, 20], target: [0, 3, -1], fov: 50 },
      tower: { position: [7, 7, 7], target: [0, 4, -2], fov: 42 },
      square: { position: [-9, 4, 8], target: [-1, 1.5, 0], fov: 48 },
      hillside: { position: [12, 5, -12], target: [-2, 2, -3], fov: 55 },
    };
    for (const [view, pose] of Object.entries(expected)) {
      choose({ view });
      assert.deepEqual(poses.at(-1), pose);
      assert.deepEqual(target.value, pose.target);
    }
    choose({ view: 'home' });
    assert.deepEqual(poses.at(-1), expected.home);
    assert.deepEqual(target.value, expected.home.target);
  } finally {
    globalThis.addEventListener = previous;
  }
});
