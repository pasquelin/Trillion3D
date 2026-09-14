import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { exactPagesBackend, referenceBackend } from './index.ts';
import { threeLodBackend } from './threeLod.ts';
import { dagRoots, dagLevel, DAG } from './pagesBackendFixture.ts';

test('source instance transforms update all three WebGL backends without rebuilding pages', () => {
  for (const factory of [referenceBackend, exactPagesBackend, threeLodBackend]) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 0, 1, 0], 3),
    );
    geometry.setIndex([0, 1, 2]);
    const material = new THREE.MeshBasicMaterial(),
      mesh = new THREE.Mesh(geometry, material),
      source = new THREE.Group();
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
    const backend = factory({
      source,
      metadata: {
        ...DAG,
        primitives: [{ mesh: 0, primitive: 0, pass: 'exact-clusters', ...dagRoots([page]) }],
      },
      indices: new Map([['0', new Uint32Array([0, 1, 2])]]),
      associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
    });
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
    camera.position.z = 5;
    camera.lookAt(0, 0, 0);
    backend.render(camera);
    mesh.position.x = 100;
    backend.render(camera);
    if (backend.id === 'exact-cluster-pages') assert.equal(backend.metrics().selectedTriangles, 0);
    else {
      const object = backend.scene.children.find(
        (child) => child.type === 'Mesh' || child.type === 'LOD',
      );
      assert.ok(object);
      assert.equal(object.matrix.elements[12], 100);
    }
    backend.dispose();
    geometry.dispose();
    material.dispose();
  }
});

test('a cut over the resident budget raises the flag and still covers the surface once', () => {
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
    maxResidentPages: 1,
  });
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  camera.position.z = 5;
  camera.lookAt(0, 0, 0);
  backend.render(camera);
  // A DAG cut is a partition: truncating it would punch a hole, so the cover stays whole and only
  // the flag is raised. Both clusters are still drawn, in one batch.
  assert.equal(backend.overBudget, true);
  let meshCount = 0;
  backend.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshCount++;
  });
  assert.equal(meshCount, 1);
  assert.equal(backend.metrics().residentPages, 2);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});

test('exact pages select coarse LOD when the screen error is under the pixel threshold', () => {
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
  const backend = exactPagesBackend({
    source,
    metadata: { ...DAG, primitives: [{ mesh: 0, primitive: 0, pass: 'exact-clusters', ...level }] },
    indices: new Map([
      ['0', new Uint32Array([0, 1, 2])],
      ['1', new Uint32Array([0, 2, 3])],
      ['2', new Uint32Array([0, 1, 2])],
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
