// A material moved to or from blended inside the session (#846): the WebGL2 display graph sorts
// its meshes by surface at every draw, and the one family its open fixed — a record rows place is
// drawn instanced unless blended, whose instances the host orders one by one — follows the move.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { createPlacementRows } from '../../placement/rows.ts';
import { triangleBackend } from './triangle.fixture.ts';

test('WebGL2 draws the rows of a material turned blended one by one, and instanced once opaque again', async () => {
  const rows = createPlacementRows(2);
  for (const row of [0, 1]) {
    rows.matrices.set(new G.Matrix4().makeTranslation(row, 0, 0).toArray(), row * 16);
    rows.live[row] = 1;
  }
  const { backend, camera, geometry, material } = triangleBackend({ placements: rows });
  const meshes = (transparent: boolean, reclassed = true) => {
    material.transparent = transparent;
    material.needsUpdate = true;
    backend.refreshMaterials!(true, reclassed);
    backend.render(camera);
    return backend.metrics().drawCalls;
  };
  try {
    await backend.prepare();
    backend.render(camera);
    assert.equal(backend.metrics().drawCalls, 1, 'opaque: one instanced mesh for both rows');
    assert.equal(meshes(true), 2, 'blended: one mesh per row, each sorted by its depth');
    assert.equal(meshes(false), 1, 'opaque again: instanced');
    assert.equal(meshes(true, false), 1, 'a values refresh alone moves no record');
  } finally {
    backend.dispose();
    geometry.dispose();
    material.dispose();
  }
});
