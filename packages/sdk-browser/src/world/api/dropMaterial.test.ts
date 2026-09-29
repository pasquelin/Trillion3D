import test from 'node:test';
import assert from 'node:assert/strict';
import { scene, refusal } from './materialApi.fixture.ts';

test('assigned materials refuse drop before mutation; reassignment allows release of every variant', async () => {
  const { api, source } = await scene();
  const first = api.createMaterial(),
    second = api.createMaterial();
  api.assignMaterial('0/0', first.id);
  api.assignMaterial('1/0', first.id);
  const variants = source.children.slice(0, 2).map((mesh) => Reflect.get(mesh, 'material'));
  let released = 0;
  for (const surface of new Set(variants)) surface.released.add(() => released++);
  assert.throws(() => api.dropMaterial(first.id), refusal('UNSUPPORTED_SCENE_UPDATE'));
  assert.equal(released, 0);
  api.assignMaterial('0/0', second.id);
  api.assignMaterial('1/0', second.id);
  api.dropMaterial(first.id);
  assert.equal(released, new Set(variants).size);
  assert.throws(() => api.material(first.id), refusal('UNKNOWN_MATERIAL'));
  const third = api.createMaterial();
  assert.notEqual(third.id, second.id);
});
