import test from 'node:test';
import assert from 'node:assert/strict';
import { preparedGraph } from './graph.ts';
import { GraphSurface } from '../graph/surface.ts';
import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';
import { BufferAttribute } from '../../../../sdk-core/src/world/buffer/attribute.ts';
import type { PreparedSceneTables } from '../../../../sdk-core/src/scene/core/tableContracts.ts';
import type { RenderBackend } from '../../backend/types.ts';
import { createExplorerMaterialApi } from '../../world/api/materialApi.ts';
import { meshes } from '../../scene/meshes.ts';
import { disposeSource } from '../../world/session/disposeSource.ts';
import { preparedVariantsOf } from './materialVariants.ts';

async function fixture() {
  const node = {
    name: '',
    mesh: 0,
    children: [],
    camera: null,
    light: null,
    skin: null,
    weights: null,
    matrix: null,
    translation: null,
    rotation: null,
    scale: null,
    visible: true,
  };
  const tables = {
    scene: { name: '', nodes: [0, 1] },
    nodes: [node, { ...node, name: 'copy' }],
    skins: [],
    animations: [],
    materialVariants: ['Paint', 'Paint'],
  } as unknown as PreparedSceneTables;
  const surfaces = [
    new GraphSurface('standard', { color: 0xff0000 }),
    new GraphSurface('standard', { color: 0x0000ff }),
    new GraphSurface('standard', { color: 0x00ff00 }),
  ];
  const geometry = new Geometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
  const { scene, ranks } = await preparedGraph({
    tables,
    meshes: [
      {
        name: 'part',
        weights: null,
        primitives: [
          {
            attributes: { POSITION: 0 },
            indices: null,
            targets: null,
            material: 0,
            variants: [
              { variant: 0, material: 1 },
              { variant: 1, material: 2 },
            ],
          },
          {
            attributes: { POSITION: 0 },
            indices: null,
            targets: null,
            material: 0,
            variants: [{ variant: 0, material: 2 }],
          },
        ],
      },
    ],
    geometryOf: () => geometry,
    materialOf: async (rank) => surfaces[rank],
  });
  const drawn = [...meshes(scene)];
  const writes: unknown[] = [];
  const backend = {
    id: 'unit',
    refreshMaterials: () => true,
    wearSurface: (change: unknown) => writes.push(change),
  } as unknown as RenderBackend;
  const api = createExplorerMaterialApi({
    check() {},
    source: scene,
    associations: ranks,
    backends: [backend],
    active: () => backend,
  });
  return { api, drawn, surfaces, backend, writes, scene };
}

test('variant sets retain duplicate names, switch every instance, reset unmapped primitives and restore defaults', async () => {
  const { api, drawn, surfaces, writes } = await fixture();
  const variants = api.materialVariants();
  assert.deepEqual(
    variants.map((v) => v.name),
    ['Paint', 'Paint'],
  );
  assert.notEqual(variants[0].id, variants[1].id);
  assert.equal(drawn.length, 4);
  assert.ok(drawn.every((mesh) => preparedVariantsOf(mesh)));
  api.selectMaterialVariant(variants[0].id);
  assert.deepEqual(
    drawn.map((mesh) => mesh.material),
    [surfaces[1], surfaces[2], surfaces[1], surfaces[2]],
  );
  api.selectMaterialVariant(variants[1].id);
  assert.deepEqual(
    drawn.map((mesh) => mesh.material),
    [surfaces[2], surfaces[0], surfaces[2], surfaces[0]],
  );
  api.selectMaterialVariant(null);
  assert.ok(drawn.every((mesh) => mesh.material === surfaces[0]));
  assert.equal(writes.length, 12);
});

test('unknown IDs and a late primitive refusal leave every surface unchanged', async () => {
  const { api, drawn, surfaces, backend, writes } = await fixture();
  assert.throws(() => api.selectMaterialVariant('absent'), { code: 'UNKNOWN_MATERIAL' });
  let checked = 0;
  backend.materialClassRefusal = () => (++checked === 3 ? 'refused' : undefined);
  assert.throws(() => api.selectMaterialVariant(api.materialVariants()[0].id), {
    code: 'MATERIAL_CLASS_CHANGE',
  });
  assert.ok(drawn.every((mesh) => mesh.material === surfaces[0]));
  assert.deepEqual(writes, []);
});

test('disposing a model releases even never-selected variant surfaces once', async () => {
  const { scene, surfaces } = await fixture();
  const released = surfaces.map(() => 0);
  surfaces.forEach((surface, rank) => surface.released.add(() => released[rank]++));
  disposeSource(scene);
  assert.deepEqual(released, [1, 1, 1]);
});

test('selecting one model variant leaves another model with the same names unchanged', async () => {
  const first = await fixture(),
    second = await fixture();
  first.scene.add(second.scene);
  const variants = first.api.materialVariants();
  assert.equal(variants.length, 4);
  first.api.selectMaterialVariant(variants[0].id);
  assert.ok(second.drawn.every((mesh) => mesh.material === second.surfaces[0]));
  assert.equal(first.drawn[0].material, first.surfaces[1]);
});
