// A material the page created, assigned to a drawable (#847): WebGL2 draws its pages in it, in
// the variant the drawable's geometry asks for and the family its alpha mode gives them (#846);
// a drawable the open laid out as a forward copy is refused by name.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { createExplorerMaterialApi } from '../../world/api/materialApi.ts';
import { liveRows, triangleBackend } from './triangle.fixture.ts';

/** The triangle opened on WebGL2, its material API, what its display graph draws, then closed. */
async function withTriangle(
  opened: ReturnType<typeof triangleBackend>,
  body: (
    api: ReturnType<typeof createExplorerMaterialApi>,
    drawn: () => { calls: number; surfaces: G.GraphSurface[] },
  ) => void,
) {
  const { backend, camera, geometry, material, mesh, source } = opened;
  const api = createExplorerMaterialApi({
    check: () => {},
    source,
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
    backends: [backend],
    active: () => backend,
  });
  // The page meshes of the display graph, beside its lights' group.
  const drawn = () => {
    backend.render(camera);
    const surfaces = (backend.scene as unknown as G.Group).children.flatMap((child) =>
      'material' in child ? [child.material as G.GraphSurface] : [],
    );
    return { calls: backend.metrics().drawCalls, surfaces };
  };
  try {
    await backend.prepare();
    body(api, drawn);
  } finally {
    backend.dispose();
    geometry.dispose();
    material.dispose();
  }
}
const rgb = (surface: G.GraphSurface) => (surface.color as G.Color).toArray();

test('WebGL2 draws a drawable in the material the page created and assigned it', () =>
  withTriangle(triangleBackend({ placements: liveRows(2) }), (api, drawn) => {
    assert.equal(drawn().calls, 1, 'the two rows are one instanced mesh');
    const made = api.createMaterial({ baseColor: [0, 0, 1], roughness: 0.5 });
    assert.equal(api.assignMaterial('0/0', made.id), true);
    const worn = new Set(drawn().surfaces);
    assert.equal(worn.size, 1, 'every page wears one surface');
    assert.deepEqual(rgb([...worn][0]), [0, 0, 1]);
    // Blended, each row is a mesh of its own: the family follows the created surface.
    assert.equal(api.setMaterial(made.id, { alphaMode: 'blend', opacity: 0.5 }), true);
    assert.equal(drawn().calls, 2);
  }));

test('a vertex-coloured drawable keeps its colours on WebGL2 with a created material', () => {
  const opened = triangleBackend({}, G.basicSurface({ side: G.DOUBLE_SIDE, vertexColors: true }));
  opened.geometry.setAttribute('color', G.floatAttribute(new Array(9).fill(1), 3));
  return withTriangle(opened, (api, drawn) => {
    const made = api.createMaterial({ baseColor: [0, 0, 1] });
    assert.equal(api.assignMaterial('0/0', made.id), true);
    api.setMaterial(made.id, { baseColor: [0, 1, 0] });
    const { surfaces } = drawn();
    assert.ok(surfaces.length, 'the page is drawn');
    for (const surface of surfaces) {
      assert.equal(surface.vertexColors, true, 'every page reads its colours');
      assert.deepEqual(rgb(surface), [0, 1, 0], 'the coloured variant follows a write');
    }
  });
});

test('a drawable WebGL2 draws as a forward copy is refused another surface by name', () => {
  const material = G.basicSurface({ side: G.DOUBLE_SIDE, transparent: true, opacity: 0.5 });
  const opened = triangleBackend({ pass: 'shared-blend' }, material);
  return withTriangle(opened, (api) => {
    const made = api.createMaterial({ alphaMode: 'blend', opacity: 0.25 }).id;
    assert.throws(
      () => api.assignMaterial('0/0', made),
      (error: { code?: string; message: string }) =>
        error.code === 'MATERIAL_CLASS_CHANGE' && /forward copy/.test(error.message),
    );
    assert.equal(opened.mesh.material, material, 'nothing written');
  });
});
