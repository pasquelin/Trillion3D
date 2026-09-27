// A material the page created, assigned to a drawable (#847): WebGL2 draws its pages in it, and
// in the family its alpha mode gives them, as the open would (#846).
import test from 'node:test';
import assert from 'node:assert/strict';
import type * as G from '../../host/graph/graph.fixture.ts';
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
