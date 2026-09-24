import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { exactPagesBackend } from '../../../../bench/witnesses/measurement.ts';
import { drawnTriangles, dagRoots, dagLevel, DAG } from './pagesBackend.fixture.ts';
import {
  quadScene,
  quadPages,
  quadCluster,
  quadIndices,
  frontCamera,
} from './pagesBackendScenes.fixture.ts';
import { submittedDraws } from '../cluster/batchMesh.ts';

test('exact pages keep replica meshes in separate batches despite shared glTF ids', () => {
  const { geometry, material, mesh: m1, source } = quadScene();
  const m2 = new THREE.Mesh(geometry, material);
  m2.matrixAutoUpdate = false;
  m2.matrix.elements[12] = 2;
  m2.updateMatrixWorld(true);
  source.add(m2);
  const pages = quadPages();
  const backend = exactPagesBackend({
    source,
    metadata: {
      ...DAG,
      schema: 1,
      status: 'ready',
      key: 'k',
      scope: 'full',
      sourceTriangles: 0,
      selectedTriangles: 0,
      selectedNodes: [],
      totalNodes: 0,
      primitives: [{ mesh: 0, primitive: 0, pass: 'exact-clusters', ...dagRoots(pages) }],
    },
    indices: quadIndices(),
    associations: new Map([
      [m1, { meshes: 0, primitives: 0 }],
      [m2, { meshes: 0, primitives: 0 }],
    ]),
    maxResidentPages: 10,
  });
  const meshes = () => submittedDraws(backend);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  camera.position.z = 8;
  camera.lookAt(0, 0, 0);
  backend.render(camera);
  assert.equal(backend.metrics().clusters, 4);
  assert.equal(meshes().length, 2);
  const xs = meshes()
    .map((mesh) => mesh.matrix.elements[12])
    .sort((a, b) => a - b);
  assert.deepEqual(xs, [0, 2]);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});

test('a missing replacement keeps the resident coarse cover rather than leaving a hole', () => {
  const { geometry, material, mesh, source } = quadScene();
  const cluster = quadCluster;
  // Two clusters replaced by one coarser cluster whose screen error clears a 10 px budget.
  const level = dagLevel([cluster(0), cluster(1)], [cluster(2)], 0.001);
  const context = {
    source,
    metadata: {
      ...DAG,
      schema: 1,
      status: 'ready',
      key: 'k',
      scope: 'full' as const,
      sourceTriangles: 0,
      selectedTriangles: 0,
      selectedNodes: [] as number[],
      totalNodes: 0,
      primitives: [{ mesh: 0, primitive: 0, pass: 'exact-clusters', ...level }],
    },
    indices: new Map(),
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
    pixelError: 0,
    viewport: [960, 540] as [number, number],
  };
  const backend = exactPagesBackend(context);
  const camera = frontCamera();
  // The pinned root cluster is the only one resident: it covers the frame on its own.
  backend.acceptPage?.('2', new Uint32Array([0, 1, 2]));
  backend.render(camera);
  const triangles = () => drawnTriangles(backend);
  assert.equal(triangles(), 1);
  assert.deepEqual(
    backend.pendingUrls?.().sort(),
    ['0', '1'],
    'the finer cut is what the streamer is asked for',
  );
  assert.equal(backend.overBudget, false);
  assert.equal(backend.metrics().selectedTriangles, 2, 'the wanted cut is the fine one');
  assert.equal(
    backend.metrics().submittedTriangles,
    1,
    'what is drawn is the resident coarse cover',
  );
  // One of the two replacements alone cannot replace the cover: a half swap would leave a hole.
  backend.acceptPage?.('0', new Uint32Array([0, 1, 2]));
  backend.render(camera);
  assert.equal(triangles(), 1);
  backend.acceptPage?.('1', new Uint32Array([0, 2, 3]));
  backend.render(camera);
  assert.equal(triangles(), 2);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});
