import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { exactPagesBackend } from './index.ts';
import { dagRoots, DAG } from './pagesBackendFixture.ts';

test('exact pages attach accepted pages in the same frame without a second frustum walk', () => {
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
    indices: new Map(),
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
    maxResidentPages: 2,
  });
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  camera.position.z = 5;
  camera.lookAt(0, 0, 0);
  backend.render(camera);
  backend.acceptPage?.('0', new Uint32Array([0, 1, 2]));
  backend.syncResident?.();
  assert.equal(backend.metrics().residentPages, 1);
  backend.acceptPage?.('1', new Uint32Array([0, 2, 3]));
  backend.syncResident?.();
  assert.equal(backend.metrics().residentPages, 2);
  const meshes: THREE.Mesh[] = [];
  backend.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  assert.equal(meshes.length, 1);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});

test('exact pages stream selected clusters: pending URLs attach on acceptPage', () => {
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
    indices: new Map(),
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
    maxResidentPages: 2,
  });
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  camera.position.z = 5;
  camera.lookAt(0, 0, 0);
  backend.render(camera);
  assert.equal(backend.metrics().clusters, 2);
  assert.equal(backend.metrics().residentPages, 0);
  assert.deepEqual(backend.pendingUrls?.().sort(), ['0', '1']);
  backend.acceptPage?.('0', new Uint32Array([0, 1, 2]));
  backend.render(camera);
  assert.equal(backend.metrics().residentPages, 1);
  assert.deepEqual(backend.pendingUrls?.(), ['1']);
  backend.acceptPage?.('1', new Uint32Array([0, 2, 3]));
  backend.render(camera);
  assert.equal(backend.metrics().residentPages, 2);
  assert.deepEqual(backend.pendingUrls?.(), []);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});

test('a primitive whose clusters are all roots selects every one of them', () => {
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
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
    maxResidentPages: 2,
  });
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  camera.position.z = 5;
  camera.lookAt(0, 0, 0);
  backend.render(camera);
  assert.equal(backend.metrics().clusters, 2);
  assert.equal(backend.metrics().residentPages, 2);
  assert.equal(backend.metrics().selectedTriangles, 2);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});
