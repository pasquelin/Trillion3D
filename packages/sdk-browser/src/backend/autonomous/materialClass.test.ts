// A material moved to or from blended inside the session (#846): the WebGL2 display graph sorts
// its meshes by surface at every draw, and the one family its open fixed — a record rows place is
// drawn instanced unless blended, whose instances the host orders one by one — follows the move.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { liveRows, triangleBackend } from './triangle.fixture.ts';

test('WebGL2 draws the rows of a material turned blended one by one, and instanced once opaque again', async () => {
  const { backend, camera, geometry, material } = triangleBackend({ placements: liveRows(2) });
  const meshes = (to: 'blend' | 'opaque', classMoved = true) => {
    const from = material.transparent ? 'blend' : 'opaque';
    material.transparent = to === 'blend';
    material.needsUpdate = true;
    backend.refreshMaterials!(true, classMoved ? { surfaces: [material], from, to } : undefined);
    backend.render(camera);
    return backend.metrics().drawCalls;
  };
  try {
    await backend.prepare();
    backend.render(camera);
    assert.equal(backend.metrics().drawCalls, 1, 'opaque: one instanced mesh for both rows');
    assert.equal(meshes('blend'), 2, 'blended: one mesh per row, each sorted by its depth');
    assert.equal(meshes('opaque'), 1, 'opaque again: instanced');
    assert.equal(meshes('blend', false), 1, 'a values refresh alone moves no record');
  } finally {
    backend.dispose();
    geometry.dispose();
    material.dispose();
  }
});

// The page ceiling counts what an instance adds to the cover: one mesh per record drawn on its own.
// Once the rows' material turned blended, each row's record is one, and an instance adds two.
test('the page ceiling counts an instance of a material turned blended by its own meshes', async () => {
  const material = G.basicSurface({ side: G.DOUBLE_SIDE });
  const { backend, camera, geometry } = triangleBackend({ placements: liveRows(2) }, material, {
    maxResidentPages: 3,
  });
  const pose = new G.Matrix4().toArray() as unknown as Float64Array;
  try {
    await backend.prepare();
    backend.addInstance!('opaque', Float64Array.from(pose));
    backend.removeInstance!('opaque');
    material.transparent = true;
    material.needsUpdate = true;
    backend.refreshMaterials!(true, { surfaces: [material], from: 'opaque', to: 'blend' });
    backend.render(camera);
    // Two meshes the cover hangs and two the instance would add: past a ceiling of three.
    assert.throws(
      () => backend.addInstance!('blended', Float64Array.from(pose)),
      /AUTONOMOUS_ROOT_BUDGET/,
    );
  } finally {
    backend.dispose();
    geometry.dispose();
    material.dispose();
  }
});
