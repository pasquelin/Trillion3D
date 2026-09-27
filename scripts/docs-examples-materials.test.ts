import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runExampleModule } from './docs/examples/capture.ts';
import { geometry, light, material, math, object } from '../packages/sdk-browser/src/index.ts';
import { Camera } from '../packages/sdk-core/src/world/camera/camera.ts';
import { Scene } from '../packages/sdk-browser/src/world/core/scene.ts';

type Values = Record<string, boolean | number | string>;
type Frame = (frame: { delta: number }) => void;

async function materialExample(id: string) {
  const html = await readFile(new URL(`../site/examples/${id}.html`, import.meta.url), 'utf8');
  const scene = new Scene(() => Promise.reject(new Error('the page loads no model')));
  const camera = new Camera('perspective');
  const target = { set() {} };
  let frame: Frame = () => {};
  let change: (values: Values) => void = () => {};
  let values: Values = {};
  let invalidations = 0;
  await runExampleModule(html, {
    engine: {
      createWorld: () => ({
        scene,
        camera,
        controls: { target },
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
      controls: (specs: Record<string, unknown>, callback: (next: Values) => void) => {
        values = Object.fromEntries(
          Object.entries(specs).map(([key, spec]) => [key, Array.isArray(spec) ? spec[2] : spec]),
        ) as Values;
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
    (node) => node.type === 'Mesh' && node.material?.kind === 'meshPhysical',
  );
  assert.equal(discs.length, 5);
  const steel = discs[0].material;
  Object.assign(run.values, { anisotropy: 0.4, direction: 1.7, roughness: 0.6 });
  run.change(run.values);
  assert.deepEqual([steel.anisotropy, steel.anisotropyRotation, steel.roughness], [0.4, 1.7, 0.6]);
  const turns = discs.map(({ rotation }) => rotation.z);
  run.frame({ delta: 0.5 });
  assert.deepEqual(
    discs.map(({ rotation }) => rotation.z),
    turns.map((turn) => turn + 0.12),
  );
  const invalidations = run.invalidations();
  run.values.spin = false;
  run.frame({ delta: 0.5 });
  assert.deepEqual(
    discs.map(({ rotation }) => rotation.z),
    turns.map((turn) => turn + 0.12),
  );
  assert.equal(run.invalidations(), invalidations);
});

test('car paint controls both physical layers and turns the complete car', async () => {
  const run = await materialExample('car-paint-under-clear-coat');
  const car = run.scene.children.find((node) => node.type === 'Group');
  assert.ok(car);
  const painted = car.children.filter((node) => node.material?.kind === 'meshPhysical');
  assert.equal(painted.length, 2);
  const paint = painted[0].material;
  Object.assign(run.values, { paint: '#2457a6', clearCoat: 0.35, coatRoughness: 0.42 });
  run.change(run.values);
  assert.equal(paint.color.getHexString(), '2457a6');
  assert.deepEqual([paint.clearcoat, paint.clearcoatRoughness], [0.35, 0.42]);
  const turn = car.rotation.y;
  run.frame({ delta: 0.5 });
  assert.equal(car.rotation.y, turn + 0.14);
  const invalidations = run.invalidations();
  run.values.turntable = false;
  run.frame({ delta: 0.5 });
  assert.equal(car.rotation.y, turn + 0.14);
  assert.equal(run.invalidations(), invalidations);
});
