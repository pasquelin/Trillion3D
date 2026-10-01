import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runControlledExample } from './docs/examples/controlled.ts';
import { Mesh, Vector3 } from '../packages/sdk/browser.ts';
import { fakeWorld } from './docs/examples/world.ts';

type Values = Record<string, boolean | number | string>;

async function materialExample(id: string) {
  const html = await readFile(new URL(`../site/examples/${id}.html`, import.meta.url), 'utf8');
  const { world, state, frame } = fakeWorld();
  const { values, change } = await runControlledExample<Values>(html, world);
  return { scene: world.scene, frame, change, values, invalidations: () => state.invalidations };
}

test('physical-material examples are published on the backend that renders their lobes', async () => {
  const roadmap = JSON.parse(
    await readFile(new URL('../site/content/gallery-roadmap.json', import.meta.url), 'utf8'),
  ) as { entries: { id: string; issue?: number; status?: string; file?: string }[] };
  for (const id of ['brushed-metal', 'car-paint-under-clear-coat']) {
    const entry = roadmap.entries.find((entry) => entry.id === id);
    assert.ok(entry?.file, id);
    assert.equal(entry.status, undefined, id);
    assert.equal(entry.issue, undefined, id);
    const html = await readFile(new URL(`../site/examples/${id}.html`, import.meta.url), 'utf8');
    assert.doesNotMatch(html, /Waits for #33/, id);
    assert.match(html, /renderer: 'webgl2'/, id);
  }
});

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
