import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { exactPagesBackend } from './index.ts';
import { clusterSphere, dagLevel, DAG } from './pagesBackendFixture.ts';

test('pixelError is read from the context each frame', () => {
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
    indices: new Map([
      ['0', new Uint32Array([0, 1, 2])],
      ['1', new Uint32Array([0, 2, 3])],
      ['2', new Uint32Array([0, 1, 2])],
    ]),
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
    pixelError: 0,
    viewport: [960, 540] as [number, number],
  };
  const backend = exactPagesBackend(context);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  camera.position.z = 5;
  camera.lookAt(0, 0, 0);
  backend.render(camera);
  assert.equal(backend.metrics().clusters, 2);
  context.pixelError = 10;
  backend.render(camera);
  assert.equal(backend.metrics().clusters, 1);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});

test('a three-level DAG picks the middle reduction and skips the one above it', () => {
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
  // Three levels: clusters 0+1 reduce to 2, which reduces to 3. At 10 px only the middle level fits.
  const cluster = (id: number) => ({
    id,
    url: String(id),
    count: 3,
    min: [-1, -1, 0],
    max: [1, 1, 0],
    bytes: 12,
    sha256: 'x',
  });
  const mid = 0.001,
    top = 1e6,
    sphere = clusterSphere(cluster(2));
  const pages = [
    ...[0, 1].map((id) => ({
      ...cluster(id),
      role: 'exact' as const,
      start: id * 3,
      level: 0,
      lodError: 0,
      sphere: clusterSphere(cluster(id)),
      parentError: mid,
      parentSphere: sphere,
      group: 0,
      source: null,
    })),
    {
      ...cluster(2),
      role: 'coarse' as const,
      start: 0,
      level: 1,
      lodError: mid,
      sphere,
      parentError: top,
      parentSphere: sphere,
      group: 1,
      source: 0,
    },
    {
      ...cluster(3),
      role: 'coarse' as const,
      start: 0,
      level: 2,
      lodError: top,
      sphere,
      parentError: null,
      parentSphere: null,
      group: null,
      source: 1,
    },
  ];
  const structure = {
    version: 1,
    roots: [3],
    groups: [
      { level: 1, error: mid, sphere, children: [0, 1], outputs: [2] },
      { level: 2, error: top, sphere, children: [2], outputs: [3] },
    ],
  };
  const backend = exactPagesBackend({
    source,
    metadata: {
      ...DAG,
      primitives: [{ mesh: 0, primitive: 0, pass: 'exact-clusters', pages, structure }],
    },
    indices: new Map([
      ['0', new Uint32Array([0, 1, 2])],
      ['1', new Uint32Array([0, 2, 3])],
      ['2', new Uint32Array([0, 1, 2])],
      ['3', new Uint32Array([0, 2, 3])],
    ]),
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
    pixelError: 10,
    viewport: [960, 540],
  });
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  camera.position.z = 5;
  camera.lookAt(0, 0, 0);
  backend.render(camera);
  assert.equal(backend.metrics().clusters, 1);
  assert.equal(backend.metrics().selectedTriangles, 1);
  assert.equal(backend.metrics().lodLevel, 1);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});
