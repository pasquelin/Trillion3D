import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { exactPagesBackend } from './index.ts';
import { drawnTriangles, dagRoots, dagLevel, DAG } from './pagesBackendFixture.ts';

test('exact pages keep replica meshes in separate batches despite shared glTF ids', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const material = new THREE.MeshBasicMaterial();
  const m1 = new THREE.Mesh(geometry, material),
    m2 = new THREE.Mesh(geometry, material);
  m2.matrixAutoUpdate = false;
  m2.matrix.elements[12] = 2;
  m2.updateMatrixWorld(true);
  const source = new THREE.Group();
  source.add(m1);
  source.add(m2);
  const pages = [0, 1].map((id) => ({
    id,
    url: String(id),
    count: 3,
    min: [-1, -1, 0],
    max: [1, 1, 0],
    bytes: 12,
    sha256: 'x',
  }));
  const backend = exactPagesBackend({
    source,
    metadata: {
      ...DAG,
      primitives: [{ mesh: 0, primitive: 0, pass: 'exact-clusters', ...dagRoots(pages) }],
    },
    indices: new Map([
      ['0', new Uint32Array([0, 1, 2])],
      ['1', new Uint32Array([0, 2, 3])],
    ]),
    associations: new Map([
      [m1, { meshes: 0, primitives: 0 }],
      [m2, { meshes: 0, primitives: 0 }],
    ]),
    maxResidentPages: 10,
  });
  const meshes = () => {
    const found: THREE.Mesh[] = [];
    backend.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) found.push(o as THREE.Mesh);
    });
    return found;
  };
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
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const material = new THREE.MeshBasicMaterial(),
    mesh = new THREE.Mesh(geometry, material),
    source = new THREE.Group();
  source.add(mesh);
  const cluster = (id: number) => ({
    id,
    url: String(id),
    count: 3,
    min: [-1, -1, 0],
    max: [1, 1, 0],
    bytes: 12,
    sha256: 'x',
  });
  // Two clusters replaced by one coarser cluster whose screen error clears a 10 px budget.
  const level = dagLevel([cluster(0), cluster(1)], [cluster(2)], 0.001);
  const context = {
    source,
    metadata: { ...DAG, primitives: [{ mesh: 0, primitive: 0, pass: 'exact-clusters', ...level }] },
    indices: new Map(),
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
    pixelError: 0,
    viewport: [960, 540] as [number, number],
  };
  const backend = exactPagesBackend(context);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  camera.position.z = 5;
  camera.lookAt(0, 0, 0);
  // The pinned root cluster is the only one resident: it covers the frame on its own.
  backend.acceptPage?.('2', new Uint32Array([0, 1, 2]));
  backend.render(camera);
  const triangles = () => drawnTriangles(backend.scene);
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
