// A material placed by rows turned blended inside the session (#846): each row becomes a mesh of
// its own, and past the host page ceiling the move is refused by name before any write, by the
// check the open and every instance run (`AUTONOMOUS_ROOT_BUDGET`).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { preparedMaterials } from '../../host/prepared/materials.ts';
import { createPlacementRows } from '../../placement/rows.ts';
import { createExplorerMaterialApi } from '../../world/api/materialApi.ts';
import { entry } from '../../world/api/materialApi.fixture.ts';
import { triangleBackend } from './triangle.fixture.ts';

test('WebGL2 refuses a class change that would take the cover past the host ceiling', async () => {
  const rows = createPlacementRows(3);
  for (const row of [0, 1, 2]) {
    rows.matrices.set(new G.Matrix4().makeTranslation(row, 0, 0).toArray(), row * 16);
    rows.live[row] = 1;
  }
  const plain = { vertexColors: false, flatShading: false };
  const surface = await preparedMaterials([entry({})], async () => null)(0, plain);
  const { backend, camera, geometry, source } = triangleBackend({ placements: rows }, surface);
  const api = createExplorerMaterialApi({
    check: () => {},
    source,
    backends: [backend],
    active: () => backend,
  });
  const drawn = () => (backend.render(camera), backend.metrics().drawCalls);
  try {
    await backend.prepare();
    assert.equal(drawn(), 1, 'opaque: the three rows are one instanced mesh, under two pages');
    const version = surface.version;
    assert.throws(
      () => api.setMaterial('0', { alphaMode: 'blend' }),
      (error: { code?: string; message: string; details?: { engine?: string } }) =>
        error.code === 'MATERIAL_CLASS_CHANGE' &&
        error.details?.engine === 'autonomous-pages-webgl' &&
        error.message.includes('AUTONOMOUS_ROOT_BUDGET'),
    );
    assert.equal(surface.version, version, 'nothing written');
    assert.equal(api.material('0').alphaMode, 'opaque');
    assert.equal(drawn(), 1, 'nothing reassigned: still one instanced mesh');
    assert.equal(api.setMaterial('0', { alphaMode: 'mask' }), true, 'a cutout stays instanced');
  } finally {
    backend.dispose();
    geometry.dispose();
    surface.dispose();
  }
});
