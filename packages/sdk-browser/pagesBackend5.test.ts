import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { exactPagesBackend } from './index.ts';
import { dagRoots, DAG } from './pagesBackendFixture.ts';

test('page bounding sphere uses the page AABB, not the shared source mesh', () => {
  const positions = new Float32Array(300);
  positions.set([-1000, -1000, -1000, 1000, -1000, -1000, 1000, 1000, -1000], 0);
  positions.set([-1, -1, 0, 1, -1, 0, 1, 1, 0], 9);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex([3, 4, 5]);
  const material = new THREE.MeshBasicMaterial(),
    mesh = new THREE.Mesh(geometry, material),
    source = new THREE.Group();
  source.add(mesh);
  const pages = [
    { id: 0, url: '0', count: 3, min: [-1, -1, 0], max: [1, 1, 0], bytes: 12, sha256: 'x' },
  ];
  const backend = exactPagesBackend({
    source,
    metadata: {
      ...DAG,
      primitives: [{ mesh: 0, primitive: 0, pass: 'exact-clusters', ...dagRoots(pages) }],
    },
    indices: new Map([['0', new Uint32Array([3, 4, 5])]]),
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
  });
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  camera.position.z = 5;
  camera.lookAt(0, 0, 0);
  backend.render(camera);
  const attached: THREE.Mesh[] = [];
  backend.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) attached.push(o as THREE.Mesh);
  });
  assert.equal(attached.length, 1);
  const sphere = attached[0].geometry.boundingSphere;
  assert.ok(sphere);
  assert.ok(
    sphere.radius < 5,
    `page sphere must not scan the source mesh, got radius ${sphere.radius}`,
  );
  backend.dispose();
  geometry.dispose();
  material.dispose();
});

test('exact pages batch clusters of the same primitive in beauty mode and unbatch in diagnostic mode', () => {
  const g1 = new THREE.BufferGeometry();
  g1.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3),
  );
  g1.setIndex([0, 1, 2, 0, 2, 3]);
  const g2 = new THREE.BufferGeometry();
  g2.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([2, -1, 0, 4, -1, 0, 4, 1, 0, 2, 1, 0], 3),
  );
  g2.setIndex([0, 1, 2, 0, 2, 3]);
  const m1 = new THREE.Mesh(g1, new THREE.MeshBasicMaterial()),
    m2 = new THREE.Mesh(g2, new THREE.MeshBasicMaterial());
  const source = new THREE.Group();
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
  const countMeshes = () => {
    let n = 0;
    backend.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) n++;
    });
    return n;
  };
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
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
