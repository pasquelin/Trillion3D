import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../host/graph/graph.fixture.ts';
import { exactPagesBackend } from '../../../../bench/witnesses/exact/backend.ts';
import { dagRoots, DAG, MANIFEST_IDENTITY } from './pagesBackend.fixture.ts';
import {
  quadScene,
  quadPages,
  quadIndices,
  frontCamera,
  assertSingleCoarseCluster,
  coarseQuadContext,
  triangleGeometry,
} from './pagesBackendScenes.fixture.ts';
import { submittedDraws } from '../cluster/submissions.fixture.ts';

test('a source instance moved out of view after a first frame selects no triangle in the exact backend', () => {
  const geometry = triangleGeometry();
  const material = G.basicSurface(),
    mesh = G.mesh(geometry, material),
    source = new G.Group();
  source.add(mesh);
  const page = {
    id: 0,
    url: '0',
    count: 3,
    min: [-1, -1, 0],
    max: [1, 1, 0],
    bytes: 12,
    sha256: 'x',
  };
  const backend = exactPagesBackend({
    source,
    metadata: {
      ...DAG,
      ...MANIFEST_IDENTITY,
      primitives: [{ mesh: 0, primitive: 0, pass: 'exact-clusters', ...dagRoots([page]) }],
    },
    indices: new Map([['0', new Uint32Array([0, 1, 2])]]),
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
  });
  const camera = G.perspectiveCamera(55, 1, 0.1, 100);
  camera.position.z = 5;
  camera.lookAt(0, 0, 0);
  backend.render(camera);
  mesh.position.x = 100;
  backend.render(camera);
  assert.equal(backend.metrics().selectedTriangles, 0);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});

test('a cut over the resident budget raises the flag and still covers the surface once', () => {
  const { geometry, material, mesh, source } = quadScene();
  const pages = quadPages();
  const backend = exactPagesBackend({
    source,
    metadata: {
      ...DAG,
      ...MANIFEST_IDENTITY,
      primitives: [{ mesh: 0, primitive: 0, pass: 'exact-clusters', ...dagRoots(pages) }],
    },
    indices: quadIndices(),
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
    maxResidentPages: 1,
  });
  const camera = frontCamera();
  backend.render(camera);
  // A DAG cut is a partition: truncating it would punch a hole, so the cover stays whole and only
  // the flag is raised. Both clusters are still drawn, in one batch.
  assert.equal(backend.overBudget, true);
  assert.equal(submittedDraws(backend).length, 1);
  assert.equal(backend.metrics().residentPages, 2);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});

test('exact pages select coarse LOD when the screen error is under the pixel threshold', () => {
  const { geometry, material, context } = coarseQuadContext(10);
  const backend = exactPagesBackend(context);
  assertSingleCoarseCluster(backend, { geometry, material });
});
