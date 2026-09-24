import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../host/graph/graph.fixture.ts';
import { exactPagesBackend } from '../../../../bench/witnesses/measurement.ts';
import { dagRoots, DAG, MANIFEST_IDENTITY } from './pagesBackend.fixture.ts';
import { submittedDraws } from '../cluster/batchMesh.ts';

test('exact pages batch clusters of the same primitive in beauty mode and unbatch in diagnostic mode', () => {
  const g1 = new G.GraphGeometry();
  g1.setAttribute('position', G.floatAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g1.setIndex(G.indices([0, 1, 2, 0, 2, 3]));
  const g2 = new G.GraphGeometry();
  g2.setAttribute('position', G.floatAttribute([2, -1, 0, 4, -1, 0, 4, 1, 0, 2, 1, 0], 3));
  g2.setIndex(G.indices([0, 1, 2, 0, 2, 3]));
  const m1 = G.mesh(g1, G.basicSurface()),
    m2 = G.mesh(g2, G.basicSurface());
  const source = new G.GraphGroup();
  source.add(m1);
  source.add(m2);
  const p1 = [0, 1].map((id) => ({
    id,
    url: `p1_${id}`,
    count: 3,
    min: [-1, -1, 0],
    max: [1, 1, 0],
    bytes: 12,
    sha256: 'x',
  }));
  const p2 = [0, 1].map((id) => ({
    id,
    url: `p2_${id}`,
    count: 3,
    min: [2, -1, 0],
    max: [4, 1, 0],
    bytes: 12,
    sha256: 'x',
  }));
  const metadata = {
    ...DAG,
    ...MANIFEST_IDENTITY,
    primitives: [
      { mesh: 0, primitive: 0, pass: 'exact-clusters' as const, ...dagRoots(p1) },
      { mesh: 1, primitive: 0, pass: 'exact-clusters' as const, ...dagRoots(p2) },
    ],
  };
  const indices = new Map([
    ['p1_0', new Uint32Array([0, 1, 2])],
    ['p1_1', new Uint32Array([0, 2, 3])],
    ['p2_0', new Uint32Array([0, 1, 2])],
    ['p2_1', new Uint32Array([0, 2, 3])],
  ]);
  const associations = new Map([
    [m1, { meshes: 0, primitives: 0 }],
    [m2, { meshes: 1, primitives: 0 }],
  ]);
  const backend = exactPagesBackend({
    source,
    metadata,
    indices,
    associations,
    maxResidentPages: 10,
  });
  const countMeshes = () => submittedDraws(backend).length;
  const camera = G.perspectiveCamera(55, 1, 0.1, 100);
  camera.position.z = 8;
  camera.lookAt(1, 0, 0);
  backend.render(camera);
  // 4 clusters visible across 2 primitives -> exactly 2 batched meshes (1 per primitive)
  assert.equal(backend.metrics().clusters, 4);
  assert.equal(backend.metrics().residentPages, 4);
  assert.equal(countMeshes(), 2);
  // In clusters diagnostic mode -> 4 individual meshes for per-cluster coloring
  backend.setDiagnostic?.('clusters');
  assert.equal(countMeshes(), 4);
  // Back to beauty mode -> back to 2 batched meshes
  backend.setDiagnostic?.('beauty');
  assert.equal(countMeshes(), 2);
  backend.dispose();
  g1.dispose();
  g2.dispose();
});
