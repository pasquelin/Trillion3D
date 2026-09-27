import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runExampleModule } from './docs/examples/capture.ts';
import {
  geometry,
  light,
  material,
  math,
  Mesh,
  object,
  Vector3,
} from '../packages/sdk-browser/src/index.ts';
import { Camera } from '../packages/sdk-core/src/world/camera/camera.ts';
import { Scene } from '../packages/sdk-browser/src/world/core/scene.ts';
import { describe, type ControlSpec } from '../site/examples/kit/controls.ts';

type Values = Record<string, boolean | number | string>;
type Frame = (frame: { delta: number }) => void;

async function materialExample(id: string) {
  const html = await readFile(new URL(`../site/examples/${id}.html`, import.meta.url), 'utf8');
  const scene = new Scene(() => Promise.reject(new Error('the page loads no model')));
  let frame: Frame = () => {};
  let change: (values: Values) => void = () => {};
  let values: Values = {};
  let invalidations = 0;
  await runExampleModule(html, {
    engine: {
      createWorld: () => ({
        scene,
        camera: new Camera('perspective'),
        controls: { target: { set() {} } },
        onFrame: (hook: Frame) => void (frame = hook),
        invalidate: () => invalidations++,
      }),
      geometry,
      material,
      object,
      light,
      math,
    },
    kit: {
      controls: (specs: Record<string, ControlSpec>, callback: (next: Values) => void) => {
        values = describe(specs).values as Values;
        change = callback;
        callback(values);
        return values;
      },
    },
  });
  return { scene, frame, change, values, invalidations: () => invalidations };
}

test('brushed-metal controls the physical brush and spins every display disc', async () => {
  const run = await materialExample('brushed-metal');
  const discs = run.scene.children.filter(
    (node): node is Mesh =>
      node instanceof Mesh &&
      !Array.isArray(node.material) &&
      node.material.kind === 'meshPhysical',
  );
  const steel = discs[0].material;
  assert.ok(!Array.isArray(steel) && run.scene.children.some((node) => node.receiveShadow));
  Object.assign(run.values, { anisotropy: 0.4, direction: 1.7, roughness: 0.6 });
  run.change(run.values);
  assert.deepEqual([steel.anisotropy, steel.anisotropyRotation, steel.roughness], [0.4, 1.7, 0.6]);
  const turns = discs.map(({ rotation }) => rotation.y);
  const normal = () => new Vector3(0, 1, 0).applyQuaternion(discs[0].quaternion);
  const facing = normal();
  run.frame({ delta: 0.5 });
  assert.ok(discs.every(({ rotation }, index) => rotation.y > turns[index]));
  assert.ok(normal().dot(facing) > 1 - 1e-12);
  const moved = discs.map(({ rotation }) => rotation.y);
  const invalidations = run.invalidations();
  run.values.spin = false;
  run.frame({ delta: 0.5 });
  assert.deepEqual(
    discs.map(({ rotation }) => rotation.y),
    moved,
  );
  assert.equal(run.invalidations(), invalidations);
});

test('car paint controls both physical layers and turns the complete car', async () => {
  const run = await materialExample('car-paint-under-clear-coat');
  const car = run.scene.children.find((node) => node.type === 'Group');
  assert.ok(car);
  const painted = car.children.filter(
    (node): node is Mesh =>
      node instanceof Mesh &&
      !Array.isArray(node.material) &&
      node.material.kind === 'meshPhysical',
  );
  const paint = painted[0].material;
  assert.ok(!Array.isArray(paint) && run.scene.children.some((node) => node.receiveShadow));
  Object.assign(run.values, { paint: '#2457a6', clearCoat: 0.35, coatRoughness: 0.42 });
  run.change(run.values);
  assert.equal(paint.color.getHexString(), '2457a6');
  assert.deepEqual([paint.clearcoat, paint.clearcoatRoughness], [0.35, 0.42]);
  const turn = car.rotation.y;
  run.frame({ delta: 0.5 });
  assert.ok(car.rotation.y > turn);
  const moved = car.rotation.y;
  const invalidations = run.invalidations();
  run.values.spin = false;
  run.frame({ delta: 0.5 });
  assert.equal(car.rotation.y, moved);
  assert.equal(run.invalidations(), invalidations);
});
