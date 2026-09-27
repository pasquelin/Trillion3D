// A material the page created, assigned to a drawable (#847): WebGL2 draws its pages in it, and
// in the family its alpha mode gives them, as the open would (#846).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { createExplorerMaterialApi } from '../../world/api/materialApi.ts';
import { liveRows, triangleBackend } from './triangle.fixture.ts';

test('WebGL2 draws a drawable in the material the page created and assigned it', async () => {
  const { backend, camera, geometry, material, mesh, source } = triangleBackend({
    placements: liveRows(2),
  });
  const api = createExplorerMaterialApi({
    check: () => {},
    source,
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
    backends: [backend],
    active: () => backend,
  });
  const drawn = () => {
    backend.render(camera);
    // The page meshes of the display graph, beside its lights' group.
    const surfaces = (backend.scene as unknown as G.Group).children.flatMap((child) =>
      'material' in child ? [child.material as G.GraphSurface] : [],
    );
    return { calls: backend.metrics().drawCalls, surfaces: new Set(surfaces) };
  };
  try {
    await backend.prepare();
    assert.equal(drawn().calls, 1, 'the two rows are one instanced mesh');
    const made = api.createMaterial({ baseColor: [0, 0, 1], roughness: 0.5 });
    assert.equal(api.assignMaterial('0/0', made.id), true);
    const [worn, ...others] = drawn().surfaces;
    assert.equal(others.length, 0, 'every page wears one surface');
    const { r, g, b } = worn.color as G.Color;
    assert.deepEqual([r, g, b], [0, 0, 1]);
    assert.equal(worn, mesh.material, 'the one the drawable was given');
    // Blended, each row is a mesh of its own: the family follows the created surface.
    assert.equal(api.setMaterial(made.id, { alphaMode: 'blend', opacity: 0.5 }), true);
    assert.equal(drawn().calls, 2);
  } finally {
    backend.dispose();
    geometry.dispose();
    material.dispose();
  }
});

/** The material API of a triangle opened on WebGL2, the drawable being primitive `0/0`. */
const materialsOf = ({ backend, mesh, source }: ReturnType<typeof triangleBackend>) =>
  createExplorerMaterialApi({
    check: () => {},
    source,
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
    backends: [backend],
    active: () => backend,
  });

test('a vertex-coloured drawable keeps its colours on WebGL2 with a created material', async () => {
  const material = G.basicSurface({ side: G.DOUBLE_SIDE, vertexColors: true });
  const opened = triangleBackend({}, material);
  opened.geometry.setAttribute('color', G.floatAttribute(new Array(9).fill(1), 3));
  const { backend, camera, geometry } = opened;
  const api = materialsOf(opened);
  const worn = () => {
    backend.render(camera);
    return (backend.scene as unknown as G.Group).children.flatMap((child) =>
      'material' in child ? [child.material as G.GraphSurface] : [],
    );
  };
  try {
    await backend.prepare();
    const made = api.createMaterial({ baseColor: [0, 0, 1] });
    assert.equal(api.assignMaterial('0/0', made.id), true);
    const surfaces = worn();
    assert.ok(surfaces.length, 'the page is drawn');
    assert.ok(
      surfaces.every((surface) => surface.vertexColors),
      'every page reads its colours',
    );
    api.setMaterial(made.id, { baseColor: [0, 1, 0] });
    assert.ok(
      worn().every(({ color }) => (color as G.Color).g === 1 && (color as G.Color).b === 0),
      'the coloured variant follows a write',
    );
  } finally {
    backend.dispose();
    geometry.dispose();
    material.dispose();
  }
});

test('a drawable WebGL2 draws as a forward copy is refused another surface by name', async () => {
  const material = G.basicSurface({ side: G.DOUBLE_SIDE, transparent: true, opacity: 0.5 });
  const opened = triangleBackend({ pass: 'shared-blend' }, material);
  const api = materialsOf(opened);
  try {
    await opened.backend.prepare();
    const made = api.createMaterial({ alphaMode: 'blend', opacity: 0.25 }).id;
    assert.throws(
      () => api.assignMaterial('0/0', made),
      (error: { code?: string; message: string }) =>
        error.code === 'MATERIAL_CLASS_CHANGE' && /forward copy/.test(error.message),
    );
    assert.equal(opened.mesh.material, material, 'nothing written');
  } finally {
    opened.backend.dispose();
    opened.geometry.dispose();
    material.dispose();
  }
});
