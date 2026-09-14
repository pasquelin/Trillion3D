import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { threeLodBackend } from './threeLod.ts';
import { DAG, dag } from '../../test/fixtures/threeLod.ts';

test('THREE.LOD backend exposes one level without coarse pages and two with them', () => {
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
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  camera.position.z = 5;
  camera.lookAt(0, 0, 0);
  const none = threeLodBackend({
    source,
    metadata: {
      ...DAG,
      primitives: [{ mesh: 0, primitive: 0, pass: 'exact-clusters', pages: [] }],
    },
    indices: new Map(),
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
  });
  none.render(camera);
  assert.equal(none.capabilities.simplification, false);
  assert.equal(none.metrics().clusters, 1);
  none.dispose();
  const cluster = (id: number) => ({
    id,
    url: String(id),
    count: 3,
    min: [-1, -1, 0],
    max: [1, 1, 0],
    bytes: 12,
    sha256: 'x',
  });
  const reduced = dag([cluster(0)], [cluster(1)]);
  const withLod = threeLodBackend({
    source,
    metadata: {
      ...DAG,
      primitives: [{ mesh: 0, primitive: 0, pass: 'exact-clusters', ...reduced }],
    },
    indices: new Map([
      ['0', new Uint32Array([0, 1, 2])],
      ['1', new Uint32Array([0, 2, 3])],
    ]),
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
  });
  withLod.render(camera);
  assert.equal(withLod.capabilities.simplification, true);
  assert.ok((withLod.metrics().selectedTriangles ?? 0) > 0);
  withLod.dispose();
  geometry.dispose();
  material.dispose();
});
test('a far THREE.LOD level keeps the clusters that nothing replaces', () => {
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
  // Cluster 0 reduces to 2; cluster 1 is never replaced, so the far level is {2, 1}.
  const cluster = (id: number) => ({
    id,
    url: String(id),
    count: 3,
    min: [-1, -1, 0],
    max: [1, 1, 0],
    bytes: 12,
    sha256: 'x',
  });
  const primitive = dag([cluster(0)], [cluster(2)], [cluster(1)]);
  const backend = threeLodBackend({
    source,
    metadata: {
      ...DAG,
      primitives: [{ mesh: 0, primitive: 0, pass: 'exact-clusters', ...primitive }],
    },
    indices: new Map([
      ['0', new Uint32Array([0, 1, 2])],
      ['1', new Uint32Array([0, 2, 3])],
      ['2', new Uint32Array([0, 1, 2])],
    ]),
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
  });
  const lod = backend.scene.children.find((o) => (o as THREE.LOD).isLOD) as THREE.LOD;
  assert.ok(lod);
  assert.equal(lod.levels.length, 2);
  assert.deepEqual(
    Array.from((lod.levels[0].object as THREE.Mesh).geometry.index!.array),
    [0, 1, 2, 0, 2, 3],
  );
  // The far level is the cover in cluster order: the unreplaced cluster 1, then the reduction 2.
  assert.deepEqual(
    Array.from((lod.levels[1].object as THREE.Mesh).geometry.index!.array),
    [0, 2, 3, 0, 1, 2],
  );
  backend.dispose();
  geometry.dispose();
  material.dispose();
});
