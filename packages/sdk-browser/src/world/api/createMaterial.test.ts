// A page creates a material of its own and gives it to a drawable (#847): its values checked as a
// change's are, a ceiling on how many, no map yet, and a class an engine lays out at open refused
// by name before any write.
import test from 'node:test';
import assert from 'node:assert/strict';
import { meshes } from '../../scene/meshes.ts';
import { RUNTIME_MATERIAL_CEILING } from './materialApi.ts';
import { refusal, scene } from './materialApi.fixture.ts';

test('a created material reads back what the page named, glTF defaults elsewhere', async () => {
  const { api } = await scene();
  const made = api.createMaterial({
    name: 'paint',
    baseColor: [0.25, 0.5, 0.75],
    roughness: 0.5,
    alphaMode: 'mask',
    alphaCutoff: 0.25,
  });
  assert.deepEqual(made, {
    id: 'created-0',
    name: 'paint',
    baseColor: [0.25, 0.5, 0.75],
    opacity: 1,
    metalness: 1,
    roughness: 0.5,
    emissive: [0, 0, 0],
    side: 'front',
    alphaMode: 'mask',
    alphaCutoff: 0.25,
    tiling: null,
  });
  assert.deepEqual(api.material(made.id), made);
  assert.deepEqual(api.materials().at(-1), made, 'listed after the scene materials');
  assert.equal(api.createMaterial().id, 'created-1');
});

test('a created material is worn by the drawable it is assigned to, every engine told', async () => {
  const { api, source, refreshes } = await scene();
  const made = api.createMaterial({ baseColor: [0, 0, 1] });
  const drawable = meshes(source)[1],
    floor = api.material('0');
  assert.equal(api.assignMaterial('1/0', made.id), true, 'every engine took it');
  assert.equal(drawable.material, refreshes.at(-1)!.surfaces[0], 'the drawable wears it');
  assert.deepEqual(refreshes.at(-1)!.meshes, [drawable], 'the drawable alone');
  assert.deepEqual(api.material('0'), floor, 'the material it wore is left as it was');
  assert.equal(api.setMaterial(made.id, { roughness: 0.25 }), true, 'then set as any other');
  assert.equal(api.material(made.id).roughness, 0.25);
});

test('a created material is refused by name before anything is built or written', async () => {
  const { api, source } = await scene();
  assert.throws(
    () => api.createMaterial({ map: {} as ImageBitmap }),
    refusal('UNSUPPORTED_SCENE_UPDATE'),
  );
  assert.throws(() => api.createMaterial({ roughness: 2 }), refusal('INVALID_MATERIAL'));
  assert.equal(api.materials().length, 5, 'nothing created');
  const blended = api.createMaterial({ alphaMode: 'blend', opacity: 0.5 }).id,
    opaque = api.createMaterial().id;
  const worn = meshes(source).map((mesh) => mesh.material);
  // WebGPU lays its blended clusters out at open: none enters, none takes another surface.
  assert.throws(() => api.assignMaterial('0/0', blended), refusal('MATERIAL_CLASS_CHANGE'));
  assert.throws(() => api.assignMaterial('5/0', opaque), refusal('MATERIAL_CLASS_CHANGE'));
  assert.throws(() => api.assignMaterial('0/0', '0'), refusal('UNKNOWN_MATERIAL'));
  assert.throws(() => api.assignMaterial('9/0', opaque), refusal('UNKNOWN_SCENE_NODE'));
  assert.deepEqual(
    meshes(source).map((mesh) => mesh.material),
    worn,
    'no drawable wears another',
  );
});

test('past the declared ceiling a created material is refused by name', async () => {
  const { api } = await scene();
  for (let n = 0; n < RUNTIME_MATERIAL_CEILING; n++) api.createMaterial();
  assert.throws(
    () => api.createMaterial(),
    (error: { code?: string; details?: { ceiling?: number } }) =>
      error.code === 'MATERIAL_CEILING' && error.details?.ceiling === RUNTIME_MATERIAL_CEILING,
  );
  assert.equal(api.materials().length, 5 + RUNTIME_MATERIAL_CEILING, 'nothing built above it');
});
